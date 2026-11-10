<?php

namespace App\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Stores uploaded pictures small: resized to a sensible maximum and re-encoded as WebP (JPEG when the server has no WebP),
 * plus an optional tiny thumbnail ("<name>-t.webp") for lists. Phones on slow data load these in a fraction of the time.
 */
class ImageService
{
    /** @return string stored path of the main image (thumbnail, when made, is thumbPath($path)) */
    public function store(UploadedFile $file, string $dir, int $max = 900, ?int $thumb = 360): string
    {
        $raw = (string) file_get_contents($file->getRealPath());
        $src = @imagecreatefromstring($raw);
        if (! $src) {
            return $file->store($dir, 'public'); // unreadable / no GD: keep the original rather than fail
        }

        try {
            $src = $this->orient($src, $file);
            if (function_exists('imagepalettetotruecolor')) {
                imagepalettetotruecolor($src);
            }

            $webp = function_exists('imagewebp');
            $ext = $webp ? 'webp' : 'jpg';
            $name = trim($dir, '/').'/'.Str::random(24);

            $main = $this->encode($this->fit($src, $max), $webp);
            $small = $thumb ? $this->encode($this->fit($src, $thumb), $webp, 70) : null;
        } catch (\Throwable $e) {
            report($e);

            return $file->store($dir, 'public'); // GD could not process this picture: store it as it is, never fail the upload
        }

        Storage::disk('public')->put("$name.$ext", $main);
        if ($small !== null) {
            Storage::disk('public')->put("$name-t.$ext", $small);
        }

        return "$name.$ext";
    }

    public function delete(?string $path): void
    {
        if ($path) {
            Storage::disk('public')->delete([$path, $this->thumbPath($path)]);
        }
    }

    public function thumbPath(string $path): string
    {
        return preg_replace('/\.(webp|jpg)$/', '-t.$1', $path);
    }

    /** Resizes to fit inside max x max. Never returns false: if GD cannot resize, the picture is used as it is. */
    private function fit($src, int $max)
    {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w <= $max && $h <= $max) {
            return $src;
        }
        $nw = $w >= $h ? $max : max(1, (int) round($w * $max / $h));
        $nh = $w >= $h ? max(1, (int) round($h * $max / $w)) : $max;

        // imagecopyresampled is more reliable across GD builds than imagescale (which returns false on some images/servers)
        $dst = imagecreatetruecolor($nw, $nh);
        if ($dst) {
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 255, 255, 255, 127));
            if (imagecopyresampled($dst, $src, 0, 0, 0, 0, $nw, $nh, $w, $h)) {
                return $dst;
            }
        }
        $scaled = function_exists('imagescale') ? @imagescale($src, $nw, $nh) : false;

        return $scaled ?: $src;
    }

    private function encode($img, bool $webp, int $q = 78): string
    {
        imagealphablending($img, false);
        imagesavealpha($img, true);
        ob_start();
        if ($webp) {
            imagewebp($img, null, $q);
        } else {
            $flat = imagecreatetruecolor(imagesx($img), imagesy($img));
            imagefill($flat, 0, 0, imagecolorallocate($flat, 255, 255, 255));
            imagecopy($flat, $img, 0, 0, 0, 0, imagesx($img), imagesy($img));
            imagejpeg($flat, null, $q);
        }

        return (string) ob_get_clean();
    }

    /** Phone photos carry their rotation in EXIF; browsers apply it, GD does not. */
    private function orient($img, UploadedFile $file)
    {
        if (! function_exists('exif_read_data') || ! in_array($file->getMimeType(), ['image/jpeg', 'image/jpg'], true)) {
            return $img;
        }
        $o = @exif_read_data($file->getRealPath())['Orientation'] ?? 1;
        $angle = [3 => 180, 6 => -90, 8 => 90][$o] ?? 0;

        return $angle ? (imagerotate($img, $angle, 0) ?: $img) : $img;
    }
}

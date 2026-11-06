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
        if (! $src || ! function_exists('imagescale')) {
            return $file->store($dir, 'public'); // unreadable / no GD: keep the original rather than fail
        }
        $src = $this->orient($src, $file);

        $webp = function_exists('imagewebp');
        $ext = $webp ? 'webp' : 'jpg';
        $name = trim($dir, '/').'/'.Str::random(24);

        Storage::disk('public')->put("$name.$ext", $this->encode($this->fit($src, $max), $webp));
        if ($thumb) {
            Storage::disk('public')->put("$name-t.$ext", $this->encode($this->fit($src, $thumb), $webp, 70));
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

    private function fit($src, int $max)
    {
        $w = imagesx($src);
        $h = imagesy($src);
        if ($w <= $max && $h <= $max) {
            return $src;
        }

        return imagescale($src, $w >= $h ? $max : (int) round($w * $max / $h), $w >= $h ? (int) round($h * $max / $w) : $max, IMG_BICUBIC);
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

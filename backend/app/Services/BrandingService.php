<?php

namespace App\Services;

use App\Models\Company;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/** Stores a company's logo and generates its square PWA app icons (192 + 512 px). */
class BrandingService
{
    public function storeLogo(Company $c, UploadedFile $file): void
    {
        if ($c->logo_path) {
            Storage::disk('public')->delete($c->logo_path);
        }
        $c->logo_path = $file->store('logos', 'public');
    }

    public function storeIcon(Company $c, UploadedFile $file): void
    {
        $this->deleteIcon($c);
        $stem = 'icons/'.$c->id.'-'.Str::random(12);

        foreach ([192, 512] as $size) {
            Storage::disk('public')->put("$stem-$size.png", $this->squarePng($file, $size));
        }
        $c->icon_path = $stem;
    }

    public function deleteIcon(Company $c): void
    {
        if ($c->icon_path) {
            Storage::disk('public')->delete([$c->icon_path.'-192.png', $c->icon_path.'-512.png']);
            $c->icon_path = null;
        }
    }

    /** Centre-crops to a square and resizes (keeps transparency). */
    private function squarePng(UploadedFile $file, int $size): string
    {
        $src = @imagecreatefromstring((string) file_get_contents($file->getRealPath()));
        abort_if(! $src, 422, 'Could not read the icon image.');

        $w = imagesx($src);
        $h = imagesy($src);
        $side = min($w, $h);
        $dst = imagecreatetruecolor($size, $size);
        imagealphablending($dst, false);
        imagesavealpha($dst, true);
        imagefill($dst, 0, 0, imagecolorallocatealpha($dst, 0, 0, 0, 127));
        imagecopyresampled($dst, $src, 0, 0, intdiv($w - $side, 2), intdiv($h - $side, 2), $size, $size, $side, $side);

        ob_start();
        imagepng($dst, null, 8);

        return (string) ob_get_clean();
    }
}

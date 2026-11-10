<?php

namespace App\Services;

use App\Models\LibraryImage;
use Illuminate\Support\Facades\Cache;

/**
 * Finds the platform library photo for a dish by NAME: lower-case, brackets removed, word order ignored,
 * so "Paneer Butter Masala", "Butter Paneer Masala (Full)" and an alias all hit the same photo.
 */
class LibraryImages
{
    private const KEY = 'library_images.index.v1';

    public static function normalize(?string $s): string
    {
        $s = mb_strtolower(trim((string) $s));
        $s = preg_replace('/\([^)]*\)/u', ' ', $s);
        $tokens = preg_split('/[^\p{L}\p{N}\p{M}]+/u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        sort($tokens);

        return implode(' ', $tokens);
    }

    /** @return array{byKey: array<string,int>, paths: array<int,string>} */
    private static function index(): array
    {
        return Cache::rememberForever(self::KEY, function () {
            $byKey = [];
            $paths = [];
            foreach (LibraryImage::orderBy('id')->get(['id', 'name', 'name_mr', 'aliases', 'image_path']) as $img) {
                $paths[$img->id] = $img->image_path;
                $names = array_merge([$img->name, $img->name_mr], explode(',', (string) $img->aliases));
                foreach ($names as $n) {
                    $k = self::normalize($n);
                    if ($k !== '') {
                        $byKey[$k] = $img->id;
                    }
                }
            }

            return ['byKey' => $byKey, 'paths' => $paths];
        });
    }

    public static function pathById(?int $id): ?string
    {
        return $id ? (self::index()['paths'][$id] ?? null) : null;
    }

    public static function matchId(?string $name, ?string $nameMr = null): ?int
    {
        $idx = self::index()['byKey'];
        foreach ([$name, $nameMr] as $n) {
            $k = self::normalize($n);
            if ($k !== '' && isset($idx[$k])) {
                return $idx[$k];
            }
        }

        return null;
    }

    public static function flush(): void
    {
        Cache::forget(self::KEY);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\FoodItem;
use App\Models\LibraryImage;
use App\Services\ImageService;
use App\Services\LibraryImages;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * Platform dish-photo library.
 *  - Super admin (routes under /admin/library): upload in bulk, rename, add spellings, replace, delete.
 *  - Hotels (GET /library): read-only list used by the "Choose from library" picker.
 */
class LibraryController extends Controller
{
    public function __construct(private ImageService $images)
    {
    }

    /** Hotels: the picker list (empty when the platform admin switched library photos off for this hotel). */
    public function index(Request $r)
    {
        if (Tenant::company()?->use_library_images === false) {
            return [];
        }

        return $this->list($r);
    }

    public function adminIndex(Request $r)
    {
        return $this->list($r);
    }

    private function list(Request $r)
    {
        $q = LibraryImage::query();
        if ($s = trim((string) $r->query('search'))) {
            $q->where(fn ($w) => $w->where('name', 'like', "%$s%")->orWhere('name_mr', 'like', "%$s%")->orWhere('aliases', 'like', "%$s%"));
        }

        return $q->orderBy('name')->get(['id', 'name', 'name_mr', 'aliases', 'image_path']);
    }

    /**
     * Bulk upload: files[] (up to 20 per request). The dish name comes from the file name
     * ("paneer-butter-masala.jpg" -> "Paneer Butter Masala"). A photo whose name already exists REPLACES that photo.
     */
    public function store(Request $r)
    {
        $r->validate([
            'files' => 'required|array|min:1|max:20',
            'files.*' => 'image|max:6144',
            'name' => 'nullable|string|max:120',
            'name_mr' => 'nullable|string|max:160',
            'aliases' => 'nullable|string|max:500',
        ]);

        $files = $r->file('files');
        $out = ['created' => 0, 'replaced' => 0];
        try {
            $this->saveAll($r, $files, $out);
        } catch (\Throwable $e) {
            report($e);

            // platform-admin only route: show the real reason so a live problem can be fixed quickly
            return response()->json(['message' => 'Upload failed: '.mb_substr($e->getMessage(), 0, 300)], 500);
        }
        AuditLog::record('super.library.upload', 'library_image', null, $out);

        return response()->json($out, 201);
    }

    private function saveAll(Request $r, array $files, array &$out): void
    {
        foreach ($files as $file) {
            $name = mb_substr(count($files) === 1 && $r->filled('name') ? trim($r->input('name')) : $this->nameFromFile($file->getClientOriginalName()), 0, 120);
            $key = LibraryImages::normalize($name);
            $existing = $key === '' ? null : LibraryImage::all(['id', 'name', 'image_path'])->first(fn ($i) => LibraryImages::normalize($i->name) === $key);
            $path = $this->images->store($file, 'library');

            if ($existing) {
                $this->images->delete($existing->image_path);
                $existing->update(['image_path' => $path]);
                $out['replaced']++;
            } else {
                LibraryImage::create([
                    'name' => $name,
                    'name_mr' => count($files) === 1 ? $r->input('name_mr') : null,
                    'aliases' => count($files) === 1 ? $r->input('aliases') : null,
                    'image_path' => $path,
                ]);
                $out['created']++;
            }
        }
    }

    public function update(Request $r, int $id)
    {
        $img = LibraryImage::findOrFail($id);
        $d = $r->validate([
            'name' => 'sometimes|required|string|max:120',
            'name_mr' => 'nullable|string|max:160',
            'aliases' => 'nullable|string|max:500',
            'image' => 'nullable|image|max:6144',
        ]);
        if ($r->hasFile('image')) {
            $this->images->delete($img->image_path);
            $d['image_path'] = $this->images->store($r->file('image'), 'library');
        }
        unset($d['image']);
        $img->update($d);

        return $img->refresh();
    }

    public function destroy(int $id)
    {
        $img = LibraryImage::findOrFail($id);
        // dishes that had picked this photo go back to name matching
        FoodItem::withoutGlobalScopes()->where('library_image_id', $id)->update(['library_image_id' => null]);
        $this->images->delete($img->image_path);
        $img->delete();
        AuditLog::record('super.library.delete', 'library_image', $id);

        return response()->noContent();
    }

    private function nameFromFile(string $file): string
    {
        $base = pathinfo($file, PATHINFO_FILENAME);
        $base = preg_replace('/[-_.]+/', ' ', $base);
        $base = preg_replace('/\s*\(\d+\)$/', '', $base); // "paneer (1)" from duplicate downloads

        return Str::title(Str::squish($base)) ?: 'Dish';
    }
}

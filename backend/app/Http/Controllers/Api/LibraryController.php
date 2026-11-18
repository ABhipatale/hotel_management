<?php

namespace App\Http\Controllers\Api;

use Illuminate\Support\Facades\Storage;
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

    /**
     * Finds library photos whose file is missing, empty or not a picture (so they show as a broken image everywhere).
     * Platform admin: lists them so they can be uploaded again.
     */
    /** The folder the website really serves /storage/... from (null when it is the same place the app writes to). */
    private function webRoot(): ?string
    {
        $web = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/').'/storage';
        $real = $web !== '/storage' && is_dir($web) ? realpath($web) : false;
        $disk = realpath(Storage::disk('public')->path(''));

        return $real && $real !== $disk ? $real : null;
    }

    /** Where each photo is: ok (the website can show it), stranded (saved, but not in the website's folder), missing (nowhere). */
    public function check()
    {
        $disk = Storage::disk('public');
        $web = $this->webRoot();
        $bad = [];
        $rows = LibraryImage::orderBy('name')->get(['id', 'name', 'image_path']);
        foreach ($rows as $i) {
            $inDisk = $i->image_path && $disk->exists($i->image_path) && $disk->size($i->image_path) > 0;
            $inWeb = $web ? ($i->image_path && is_file($web.'/'.$i->image_path) && filesize($web.'/'.$i->image_path) > 0) : $inDisk;
            if ($inWeb) {
                continue;
            }
            $bad[] = ['id' => $i->id, 'name' => $i->name, 'reason' => $inDisk ? 'stranded' : 'missing'];
        }

        return ['checked' => $rows->count(), 'broken' => $bad, 'stranded' => collect($bad)->where('reason', 'stranded')->count()];
    }

    /** Copy photos that were saved outside the website's folder into it (never deletes or overwrites anything). */
    public function repair()
    {
        $web = $this->webRoot();
        $disk = Storage::disk('public');
        $copied = 0;
        if ($web) {
            foreach (LibraryImage::get(['image_path']) as $i) {
                $path = (string) $i->image_path;
                foreach ([$path, preg_replace('/(\.[^.]+)$/', '-t$1', $path)] as $f) {
                    if ($f && $disk->exists($f) && ! is_file($web.'/'.$f)) {
                        @mkdir(dirname($web.'/'.$f), 0775, true);
                        if (@copy($disk->path($f), $web.'/'.$f)) {
                            $copied++;
                        }
                    }
                }
            }
        }

        return ['copied' => $copied] + $this->check();
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
                $old = $existing->image_path;
                $existing->update(['image_path' => $path]);  // the record points at the new, saved photo first...
                $this->images->delete($old);                  // ...and only then the old file goes
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
        $old = null;
        if ($r->hasFile('image')) {
            try {
                $new = $this->images->store($r->file('image'), 'library'); // saved and checked BEFORE anything is changed or deleted
            } catch (\Throwable $e) {
                report($e);

                return response()->json(['message' => 'The new photo could not be saved, so the old one was kept: '.mb_substr($e->getMessage(), 0, 200)], 500);
            }
            $old = $img->image_path;
            $d['image_path'] = $new;
        }
        unset($d['image']);
        $img->update($d);
        if ($old) {
            $this->images->delete($old); // the old file goes last
        }
        LibraryImages::flush();

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

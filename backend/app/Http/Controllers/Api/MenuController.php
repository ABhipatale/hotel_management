<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FoodCategory;
use App\Models\FoodItem;
use App\Models\FoodItemVariant;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class MenuController extends Controller
{
    public function categories()
    {
        return FoodCategory::withCount('items')->orderBy('sort_order')->orderBy('id')->get();
    }

    public function storeCategory(Request $r)
    {
        $d = $r->validate(['name' => 'required|string|max:80', 'sort_order' => 'integer|min:0', 'is_active' => 'boolean']);
        $d['sort_order'] ??= ((int) FoodCategory::max('sort_order')) + 1; // new categories go to the end

        return response()->json(FoodCategory::create($d), 201);
    }

    /** Saves the order the owner arranged: ids in the new sequence (first = shown first everywhere). */
    public function reorderCategories(Request $r)
    {
        $d = $r->validate(['ids' => 'required|array|min:1|max:200', 'ids.*' => ['integer', Tenant::exists('food_categories')]]);
        DB::transaction(function () use ($d) {
            foreach (array_values(array_unique($d['ids'])) as $i => $id) {
                FoodCategory::where('id', $id)->update(['sort_order' => $i + 1]);
            }
        });

        return $this->categories();
    }

    public function updateCategory(Request $r, int $id)
    {
        $c = FoodCategory::findOrFail($id);
        $c->update($r->validate(['name' => 'sometimes|string|max:80', 'sort_order' => 'integer|min:0', 'is_active' => 'boolean']));

        return $c;
    }

    public function destroyCategory(int $id)
    {
        $c = FoodCategory::findOrFail($id);
        abort_if(FoodItem::where('category_id', $id)->exists(), 422, 'Category has items. Move or delete them first.');
        $c->delete();

        return response()->noContent();
    }

    public function items(Request $r)
    {
        $q = FoodItem::with('variants', 'category:id,name');
        if ($c = $r->query('category_id')) {
            $q->where('category_id', $c);
        }
        if ($s = $r->query('search')) {
            $q->where(fn ($w) => $w->where('name', 'like', "%$s%")->orWhere('name_mr', 'like', "%$s%")->orWhere('code', ctype_digit($s) ? (int) $s : -1));
        }

        return $q->orderByRaw('code is null')->orderBy('code')->orderBy('name')->get();
    }

    /** Bulk upload: a CSV with one dish per row (see the sample CSV in the Menu screen). */
    public function import(Request $r, \App\Services\MenuImporter $importer)
    {
        $r->validate(['file' => 'required|file|max:2048']);

        return $importer->import($r->file('file'));
    }

    /** Next free product number for this company (shown pre-filled in the Add dish form). */
    public function nextCode()
    {
        return ['code' => $this->nextFreeCode()];
    }

    private function nextFreeCode(): int
    {
        return ((int) FoodItem::max('code')) + 1;
    }

    public function storeItem(Request $r)
    {
        $d = $this->validated($r);

        return response()->json(DB::transaction(function () use ($r, $d) {
            $fields = $this->fields($r, $d);
            $fields['code'] ??= $this->nextFreeCode();
            $item = FoodItem::create($fields);
            $this->syncVariants($item, $d['variants'] ?? []);

            return $item->load('variants');
        }), 201);
    }

    public function updateItem(Request $r, int $id)
    {
        $item = FoodItem::findOrFail($id);
        $d = $this->validated($r, true, $id);

        return DB::transaction(function () use ($r, $item, $d) {
            $item->update($this->fields($r, $d, $item));
            if (array_key_exists('variants', $d)) {
                $this->syncVariants($item, $d['variants'] ?? []);
            }

            return $item->load('variants');
        });
    }

    public function destroyItem(int $id)
    {
        FoodItem::findOrFail($id)->delete();

        return response()->noContent();
    }

    private function validated(Request $r, bool $partial = false, ?int $ignoreId = null): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return $r->validate([
            'category_id' => [$req, Tenant::exists('food_categories')],
            'branch_id' => ['nullable', Tenant::exists('branches')],
            'code' => ['nullable', 'integer', 'min:1', 'max:99999', Rule::unique('food_items', 'code')->where('company_id', Tenant::id())->ignore($ignoreId)],
            'name' => "$req|string|max:120",
            'name_mr' => 'nullable|string|max:120',
            'description' => 'nullable|string|max:500',
            'price' => "$req|numeric|min:0",
            'gst_percent' => 'numeric|min:0|max:28',
            'discount_percent' => 'numeric|min:0|max:100',
            'is_veg' => 'boolean',
            'is_available' => 'boolean',
            'stock' => 'nullable|integer|min:0',
            'offer_text' => 'nullable|string|max:120',
            'image' => 'nullable|image|max:3072',
            'library_image_id' => ['nullable', 'integer', 'exists:library_images,id'],
            'image_action' => 'nullable|in:remove,auto',
            'variants' => 'nullable|array|max:10',
            'variants.*.name' => 'required|string|max:40',
            'variants.*.price' => 'required|numeric|min:0',
        ]);
    }

    private function fields(Request $r, array $d, ?FoodItem $existing = null): array
    {
        unset($d['variants'], $d['image'], $d['image_action']);
        if (array_key_exists('code', $d) && $d['code'] === null) {
            unset($d['code']); // blank = keep the current number (or auto-number on create)
        }
        if (! Tenant::company()->gst_enabled) {
            unset($d['gst_percent']);
        }
        if ($r->hasFile('image')) {
            $images = app(\App\Services\ImageService::class);
            if ($old = $existing?->image_path) {
                $images->delete($old);
            }
            $d['image_path'] = $images->store($r->file('image'), 'food/'.Tenant::id());
            $d['library_image_id'] = null;
            $d['hide_library_image'] = false;
        } elseif (! empty($d['library_image_id'])) {
            // picked a platform library photo: it replaces the hotel's own upload
            if ($old = $existing?->image_path) {
                app(\App\Services\ImageService::class)->delete($old);
            }
            $d['image_path'] = null;
            $d['hide_library_image'] = false;
        } else {
            unset($d['library_image_id']);
            if (in_array($r->input('image_action'), ['remove', 'auto'], true)) {
                if ($old = $existing?->image_path) {
                    app(\App\Services\ImageService::class)->delete($old);
                }
                $d['image_path'] = null;
                $d['library_image_id'] = null;
                $d['hide_library_image'] = $r->input('image_action') === 'remove';
            }
        }

        return $d;
    }

    private function syncVariants(FoodItem $item, array $variants): void
    {
        $item->variants()->delete();
        foreach ($variants as $v) {
            FoodItemVariant::create(['food_item_id' => $item->id, 'name' => $v['name'], 'price' => $v['price']]);
        }
    }
}

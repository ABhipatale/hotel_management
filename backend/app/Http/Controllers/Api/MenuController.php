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
        return FoodCategory::withCount('items')->orderBy('sort_order')->get();
    }

    public function storeCategory(Request $r)
    {
        $d = $r->validate(['name' => 'required|string|max:80', 'sort_order' => 'integer|min:0', 'is_active' => 'boolean']);

        return response()->json(FoodCategory::create($d), 201);
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
            'variants' => 'nullable|array|max:10',
            'variants.*.name' => 'required|string|max:40',
            'variants.*.price' => 'required|numeric|min:0',
        ]);
    }

    private function fields(Request $r, array $d, ?FoodItem $existing = null): array
    {
        unset($d['variants'], $d['image']);
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

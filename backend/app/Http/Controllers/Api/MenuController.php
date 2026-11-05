<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\FoodCategory;
use App\Models\FoodItem;
use App\Models\FoodItemVariant;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

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
            $q->where('name', 'like', "%$s%");
        }

        return $q->orderBy('name')->get();
    }

    public function storeItem(Request $r)
    {
        $d = $this->validated($r);

        return response()->json(DB::transaction(function () use ($r, $d) {
            $item = FoodItem::create($this->fields($r, $d));
            $this->syncVariants($item, $d['variants'] ?? []);

            return $item->load('variants');
        }), 201);
    }

    public function updateItem(Request $r, int $id)
    {
        $item = FoodItem::findOrFail($id);
        $d = $this->validated($r, true);

        return DB::transaction(function () use ($r, $item, $d) {
            $item->update($this->fields($r, $d));
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

    private function validated(Request $r, bool $partial = false): array
    {
        $req = $partial ? 'sometimes' : 'required';

        return $r->validate([
            'category_id' => [$req, Tenant::exists('food_categories')],
            'branch_id' => ['nullable', Tenant::exists('branches')],
            'name' => "$req|string|max:120",
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

    private function fields(Request $r, array $d): array
    {
        unset($d['variants'], $d['image']);
        if (! Tenant::company()->gst_enabled) {
            unset($d['gst_percent']);
        }
        if ($r->hasFile('image')) {
            $d['image_path'] = $r->file('image')->store('food/'.Tenant::id(), 'public');
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

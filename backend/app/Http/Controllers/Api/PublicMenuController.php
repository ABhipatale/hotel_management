<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Company;
use App\Models\FoodCategory;
use App\Models\FoodItem;
use App\Models\Order;
use App\Models\TableQrToken;
use App\Services\OrderService;
use App\Services\SubscriptionService;
use App\Support\Tenant;
use Illuminate\Http\Request;

/**
 * Unauthenticated QR ordering. The tenant is resolved ONLY from the (slug, token) pair:
 * the token must belong to a table of that exact company, so a token can never be replayed
 * against another company's slug.
 */
class PublicMenuController extends Controller
{
    public function menu(string $slug, string $token)
    {
        [$company, $table] = $this->resolve($slug, $token);

        return Tenant::as($company, fn () => [
            'company' => $company->branding(),
            'table' => ['number' => $table->number],
            'categories' => FoodCategory::where('is_active', true)->orderBy('sort_order')->orderBy('id')->get(['id', 'name', 'name_mr']),
            'items' => FoodItem::with('variants:id,food_item_id,name,price')->where('is_available', true)
                ->where(fn ($q) => $q->whereNull('branch_id')->orWhere('branch_id', $table->branch_id))
                ->get(['id', 'category_id', 'name', 'name_mr', 'description', 'image_path', 'library_image_id', 'hide_library_image', 'price', 'discount_percent', 'is_veg', 'offer_text', 'gst_percent']),
        ]);
    }

    public function manifest(string $slug)
    {
        $c = Company::where('slug', $slug)->whereIn('status', ['trial', 'active'])->firstOrFail();
        $icons = $c->icon_path
            ? [
                ['src' => asset('storage/'.$c->icon_path.'-192.png'), 'sizes' => '192x192', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => asset('storage/'.$c->icon_path.'-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any'],
                ['src' => asset('storage/'.$c->icon_path.'-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'maskable'],
            ]
            : [
                ['src' => url('/icon-192.png'), 'sizes' => '192x192', 'type' => 'image/png'],
                ['src' => url('/icon-512.png'), 'sizes' => '512x512', 'type' => 'image/png', 'purpose' => 'any maskable'],
            ];

        return response()->json([
            // A distinct id + start_url per company lets one phone install several companies as separate apps.
            'id' => '/?company='.$c->slug,
            'name' => $c->name,
            'short_name' => \Illuminate\Support\Str::limit($c->name, 12, ''),
            'description' => $c->name.' - billing and orders',
            'start_url' => '/?company='.$c->slug,
            'scope' => '/',
            'display' => 'standalone',
            'orientation' => 'portrait',
            'theme_color' => '#17645F', // one global product theme; tenants only customise name + logo/icon
            'background_color' => '#F3EEE8',
            'icons' => $icons,
        ])->header('Content-Type', 'application/manifest+json')->header('Cache-Control', 'no-cache');
    }

    public function order(Request $r, string $slug, string $token, OrderService $orders)
    {
        [$company, $table] = $this->resolve($slug, $token);

        return Tenant::as($company, function () use ($r, $table, $orders) {
            $d = $r->validate([
                'customer_name' => 'nullable|string|max:80',
                'customer_phone' => 'nullable|string|max:20',
                'notes' => 'nullable|string|max:255',
                'items' => 'required|array|min:1|max:40',
                'items.*.food_item_id' => ['required', Tenant::exists('food_items')],
                'items.*.variant_id' => ['nullable', Tenant::exists('food_item_variants')],
                'items.*.quantity' => 'required|integer|min:1|max:20',
            ]);
            $order = $orders->place($table->branch_id, $table, $d, 'qr');

            return response()->json(['order_no' => $order->order_no, 'tracking_code' => $this->trackingCode($order), 'status' => $order->status], 201);
        });
    }

    /** Customers poll their order by order number + the table token. */
    public function track(string $slug, string $token, string $orderNo)
    {
        [$company, $table] = $this->resolve($slug, $token);

        return Tenant::as($company, function () use ($table, $orderNo) {
            $o = Order::with('items:id,order_id,name,variant,quantity,status')->where('table_id', $table->id)->where('order_no', $orderNo)->firstOrFail();

            return ['order_no' => $o->order_no, 'status' => $o->status, 'items' => $o->items, 'created_at' => $o->created_at];
        });
    }

    /** Orders at this table for the session (open ones). */
    public function active(string $slug, string $token)
    {
        [$company, $table] = $this->resolve($slug, $token);

        return Tenant::as($company, fn () => Order::with('items:id,order_id,name,variant,quantity,status')
            ->where('table_id', $table->id)->where('source', 'qr')->whereNotIn('status', ['paid', 'cancelled'])
            ->latest()->limit(10)->get(['id', 'order_no', 'status', 'created_at']));
    }

    private function resolve(string $slug, string $token): array
    {
        $company = Company::where('slug', $slug)->whereIn('status', ['trial', 'active'])->firstOrFail();
        $state = app(SubscriptionService::class)->state($company);
        abort_if(! $company->qr_enabled || $state['expired'] || ! $state['plan']?->hasFeature('qr'), 404);

        return Tenant::as($company, function () use ($company, $token) {
            $qr = TableQrToken::where('token', $token)->where('is_active', true)->firstOrFail(); // scoped to this company
            $table = $qr->table_id ? \App\Models\HotelTable::findOrFail($qr->table_id) : abort(404);

            return [$company, $table];
        });
    }

    private function trackingCode(Order $o): string
    {
        return $o->order_no;
    }
}

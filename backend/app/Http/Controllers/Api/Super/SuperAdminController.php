<?php

namespace App\Http\Controllers\Api\Super;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Company;
use App\Models\Order;
use App\Models\PlatformSetting;
use App\Models\Subscription;
use App\Models\SubscriptionPayment;
use App\Models\SubscriptionPlan;
use App\Models\SupportTicket;
use App\Models\User;
use App\Services\CompanyProvisioner;
use App\Services\SubscriptionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Platform-level controller. All routes sit behind 'superadmin' (explicitly unscoped). */
class SuperAdminController extends Controller
{
    public function dashboard()
    {
        $active = Subscription::where('status', 'active')->where('ends_at', '>', now())->with('plan')->get();
        $companies = Company::withTrashed()->whereIn('id', $active->pluck('company_id'))->get()->keyBy('id');
        // each company's own price (or the default) - so custom prices are reflected in the monthly revenue figure
        $mrr = $active->sum(function ($s) use ($companies) {
            $c = $companies[$s->company_id] ?? null;
            $price = $c ? $c->priceFor($s->plan, $s->billing_cycle) : ($s->billing_cycle === 'yearly' ? $s->plan->price_yearly : $s->plan->price_monthly);

            return $s->billing_cycle === 'yearly' ? $price / 12 : $price;
        });

        return [
            'companies_total' => Company::count(),
            'companies_active' => Company::where('status', 'active')->count(),
            'companies_inactive' => Company::whereIn('status', ['inactive', 'suspended'])->count(),
            'subscribers' => $active->count(),
            'revenue_total' => (float) SubscriptionPayment::where('status', 'paid')->sum('amount'),
            'mrr' => round($mrr, 2),
            'expiring_soon' => Subscription::whereIn('status', ['active', 'trial'])->whereBetween('ends_at', [now(), now()->addDays(7)])->count(),
            'users_total' => User::whereNotNull('company_id')->count(),
            'orders_total' => Order::count(),
            'cycle_breakdown' => Subscription::where('status', 'active')->where('ends_at', '>', now())
                ->select('billing_cycle as name', DB::raw('count(*) as total'))->groupBy('billing_cycle')->get(),
            'revenue_by_month' => SubscriptionPayment::where('status', 'paid')->where('paid_at', '>=', now()->subMonths(11)->startOfMonth())->get()
                ->groupBy(fn ($p) => $p->paid_at->format('Y-m'))->map(fn ($g) => round($g->sum('amount'), 2)),
        ];
    }

    public function companies(Request $r)
    {
        $q = Company::withTrashed()->with(['currentSubscription.plan']);
        if ($s = $r->query('search')) {
            $q->where(fn ($w) => $w->where('name', 'like', "%$s%")->orWhere('email', 'like', "%$s%")->orWhere('uid', 'like', "%$s%"));
        }
        if ($st = $r->query('status')) {
            $q->where('status', $st);
        }

        return $q->latest()->paginate(20);
    }

    public function showCompany(int $id)
    {
        $c = Company::withTrashed()->with('currentSubscription.plan')->findOrFail($id);

        return [
            'company' => $c,
            'counters' => app(\App\Services\CounterService::class)->list($c),
            'stats' => [
                'users' => User::where('company_id', $id)->count(),
                'orders' => Order::where('company_id', $id)->count(),
            ],
            'payments' => SubscriptionPayment::where('company_id', $id)->latest()->limit(20)->get(),
        ];
    }

    public function storeCompany(Request $request, CompanyProvisioner $provisioner)
    {
        $data = $request->validate([
            'company_name' => 'required|string|max:120',
            'owner_name' => 'required|string|max:120',
            'phone' => 'required|string|max:20',
            'email' => 'required|email|unique:users,email',
            'password' => ['required', 'string', 'min:6', 'max:100'],
            'address' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:80',
            'state' => 'nullable|string|max:80',
            'pin_code' => 'nullable|string|max:10',
            'gst_number' => 'nullable|string|max:20',
            'gst_enabled' => 'sometimes|boolean',
            'qr_enabled' => 'sometimes|boolean',
            'default_language' => 'sometimes|in:en,hi,mr',
            'billing_cycle' => 'nullable|in:monthly,yearly', // empty = customer purchases the plan on first login
            'multi_counter' => 'sometimes|boolean',          // several counters (each with its own tables, staff and books)
            'counters' => 'sometimes|array|max:20',
            'counters.*' => 'nullable|string|max:60',
        ]);
        $plan = SubscriptionPlan::current();
        [$company] = $provisioner->provision($data, null, $plan, $data['billing_cycle'] ?? null);
        AuditLog::record('super.company.create', 'company', $company->id);

        return response()->json($company, 201);
    }

    public function updateCompany(Request $request, int $id, \App\Services\CounterService $counters)
    {
        $c = Company::withTrashed()->findOrFail($id);
        $data = $request->validate([
            'name' => 'sometimes|string|max:120',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email',
            'address' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:80',
            'state' => 'nullable|string|max:80',
            'pin_code' => 'nullable|string|max:10',
            'gst_number' => 'nullable|string|max:20',
            'gst_enabled' => 'sometimes|boolean',
            'qr_enabled' => 'sometimes|boolean',
            'use_library_images' => 'sometimes|boolean',
            'default_language' => 'sometimes|in:en,hi,mr',
            'multi_counter' => 'sometimes|boolean',
            // this company's own subscription price; empty / null = use the platform default price
            'price_monthly' => 'sometimes|nullable|numeric|min:0|max:10000000',
            'price_yearly' => 'sometimes|nullable|numeric|min:0|max:100000000',
        ]);
        if (array_key_exists('multi_counter', $data)) {
            if ((bool) $data['multi_counter'] !== (bool) $c->multi_counter) {
                $counters->setMode($c, (bool) $data['multi_counter']);
            }
            unset($data['multi_counter']);
            $c->refresh();
        }
        // While GST is off its fields are locked: the stored number is kept (so switching GST back on restores it)
        if (array_key_exists('gst_enabled', $data) ? ! $data['gst_enabled'] : ! $c->gst_enabled) {
            unset($data['gst_number']);
        }
        $c->update($data);
        AuditLog::record('super.company.update', 'company', $id, ['gst_enabled' => $c->gst_enabled]);

        return $c->refresh();
    }

    // ----- Counters of a multi-counter company -----
    public function counters(int $id, \App\Services\CounterService $counters)
    {
        return $counters->list(Company::findOrFail($id));
    }

    public function storeCounter(Request $request, int $id, \App\Services\CounterService $counters)
    {
        $c = Company::findOrFail($id);
        $d = $request->validate(['name' => 'required|string|max:60', 'address' => 'nullable|string|max:255']);
        $b = $counters->add($c, trim($d['name']), $d['address'] ?? null);
        AuditLog::record('super.counter.create', 'branch', $b->id);

        return response()->json($b->only('id', 'name', 'address', 'is_default', 'is_active'), 201);
    }

    public function updateCounter(Request $request, int $id, int $counterId, \App\Services\CounterService $counters)
    {
        $c = Company::findOrFail($id);
        $d = $request->validate(['name' => 'sometimes|string|max:60', 'address' => 'nullable|string|max:255', 'is_active' => 'sometimes|boolean']);
        $b = $counters->update($c, $counterId, $d);
        AuditLog::record('super.counter.update', 'branch', $b->id);

        return $b->only('id', 'name', 'address', 'is_default', 'is_active');
    }

    /** Super admin can set any company's logo and app icon. */
    public function branding(Request $request, int $id, \App\Services\BrandingService $branding)
    {
        $c = Company::findOrFail($id);
        $request->validate([
            'logo' => 'nullable|image|max:2048',
            'icon' => 'nullable|image|mimes:png,jpg,jpeg,webp|max:2048|dimensions:min_width=192,min_height=192',
            'remove_icon' => 'sometimes|boolean',
        ]);
        if ($request->hasFile('logo')) {
            $branding->storeLogo($c, $request->file('logo'));
        }
        if ($request->hasFile('icon')) {
            $branding->storeIcon($c, $request->file('icon'));
        } elseif ($request->boolean('remove_icon')) {
            $branding->deleteIcon($c);
        }
        $c->save();
        AuditLog::record('super.company.branding', 'company', $id);

        return $c->refresh();
    }

    public function setStatus(Request $request, int $id)
    {
        $data = $request->validate(['status' => 'required|in:active,inactive,suspended']);
        $c = Company::findOrFail($id);
        $c->forceFill(['status' => $data['status']])->save();
        // Revoke live sessions when a company is deactivated / suspended.
        if ($data['status'] !== 'active') {
            DB::table('personal_access_tokens')->whereIn('tokenable_id', User::where('company_id', $id)->pluck('id'))->where('tokenable_type', User::class)->delete();
        }
        AuditLog::record('super.company.status', 'company', $id, $data);

        return $c;
    }

    /** Soft delete per retention policy — data is kept until a purge job removes it. */
    public function destroyCompany(int $id)
    {
        $c = Company::findOrFail($id);
        $c->forceFill(['status' => 'inactive'])->save();
        $c->delete();
        DB::table('personal_access_tokens')->whereIn('tokenable_id', User::where('company_id', $id)->pluck('id'))->where('tokenable_type', User::class)->delete();
        AuditLog::record('super.company.delete', 'company', $id);

        return response()->noContent();
    }

    public function assignSubscription(Request $request, int $id, SubscriptionService $subs)
    {
        $data = $request->validate(['billing_cycle' => 'required|in:monthly,yearly']);
        $company = Company::findOrFail($id);
        $plan = SubscriptionPlan::current();
        $sub = $subs->activate($company, $plan, $data['billing_cycle'], 'manual');
        AuditLog::record('super.subscription.assign', 'company', $id, $data);

        return $sub->load('plan');
    }

    // --- Pricing (single subscription: monthly or yearly) ---
    public function pricing()
    {
        $p = SubscriptionPlan::current();

        return ['price_monthly' => (float) $p->price_monthly, 'price_yearly' => (float) $p->price_yearly];
    }

    public function savePricing(Request $request)
    {
        $d = $request->validate([
            'price_monthly' => 'required|numeric|min:0|max:10000000',
            'price_yearly' => 'required|numeric|min:0|max:100000000',
        ]);
        SubscriptionPlan::current()->update($d);
        AuditLog::record('super.pricing.update', 'subscription_plan', null, $d);

        return $this->pricing();
    }

    // --- Payments / reports ---
    public function payments(Request $r)
    {
        return SubscriptionPayment::with('company:id,name,uid')->latest()->paginate(30);
    }

    // --- Platform settings ---
    public function settings()
    {
        return PlatformSetting::pluck('value', 'key');
    }

    public function saveSettings(Request $request)
    {
        $data = $request->validate(['settings' => 'required|array', 'settings.*' => 'nullable|string|max:1000']);
        foreach ($data['settings'] as $k => $v) {
            PlatformSetting::updateOrCreate(['key' => $k], ['value' => $v]);
        }

        return $this->settings();
    }

    // --- Support ---
    public function tickets()
    {
        return SupportTicket::with('company:id,name')->latest()->paginate(30);
    }

    public function replyTicket(Request $request, int $id)
    {
        $data = $request->validate(['reply' => 'nullable|string|max:2000', 'status' => 'required|in:open,in_progress,resolved,closed']);
        $t = SupportTicket::findOrFail($id);
        $t->update($data);

        return $t;
    }
}

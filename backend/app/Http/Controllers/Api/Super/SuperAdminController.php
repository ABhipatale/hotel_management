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
use App\Models\Branch;
use App\Services\CompanyProvisioner;
use App\Services\SubscriptionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rules\Password;

/** Platform-level controller. All routes sit behind 'superadmin' (explicitly unscoped). */
class SuperAdminController extends Controller
{
    public function dashboard()
    {
        $active = Subscription::where('status', 'active')->where('ends_at', '>', now())->with('plan')->get();
        $mrr = $active->sum(fn ($s) => $s->billing_cycle === 'yearly' ? $s->plan->price_yearly / 12 : $s->plan->price_monthly);

        return [
            'companies_total' => Company::count(),
            'companies_active' => Company::where('status', 'active')->count(),
            'companies_inactive' => Company::whereIn('status', ['inactive', 'suspended'])->count(),
            'companies_trial' => Company::where('status', 'trial')->count(),
            'subscribers' => $active->count(),
            'revenue_total' => (float) SubscriptionPayment::where('status', 'paid')->sum('amount'),
            'mrr' => round($mrr, 2),
            'expiring_soon' => Subscription::whereIn('status', ['active', 'trial'])->whereBetween('ends_at', [now(), now()->addDays(7)])->count(),
            'users_total' => User::whereNotNull('company_id')->count(),
            'branches_total' => Branch::count(),
            'orders_total' => Order::count(),
            'plan_breakdown' => Subscription::where('status', 'active')->where('ends_at', '>', now())
                ->join('subscription_plans', 'subscription_plans.id', '=', 'subscriptions.plan_id')
                ->select('subscription_plans.name', DB::raw('count(*) as total'))->groupBy('subscription_plans.name')->get(),
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
            'stats' => [
                'users' => User::where('company_id', $id)->count(),
                'orders' => Order::where('company_id', $id)->count(),
                'branches' => Branch::where('company_id', $id)->count(),
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
            'password' => ['required', Password::min(8)->letters()->numbers()],
            'address' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:80',
            'state' => 'nullable|string|max:80',
            'pin_code' => 'nullable|string|max:10',
            'gst_number' => 'nullable|string|max:20',
            'plan_id' => 'nullable|exists:subscription_plans,id',
        ]);
        $plan = ! empty($data['plan_id']) ? SubscriptionPlan::find($data['plan_id']) : null;
        [$company] = $provisioner->provision($data, null, $plan);
        AuditLog::record('super.company.create', 'company', $company->id);

        return response()->json($company, 201);
    }

    public function updateCompany(Request $request, int $id)
    {
        $c = Company::withTrashed()->findOrFail($id);
        $data = $request->validate([
            'name' => 'sometimes|string|max:120',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email',
            'address' => 'nullable|string|max:255',
            'gst_number' => 'nullable|string|max:20',
        ]);
        $c->update($data);

        return $c;
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
        $data = $request->validate(['plan_id' => 'required|exists:subscription_plans,id', 'billing_cycle' => 'required|in:monthly,yearly', 'trial' => 'sometimes|boolean']);
        $company = Company::findOrFail($id);
        $plan = SubscriptionPlan::findOrFail($data['plan_id']);
        $sub = ! empty($data['trial']) ? $subs->startTrial($company, $plan) : $subs->activate($company, $plan, $data['billing_cycle'], 'manual');
        AuditLog::record('super.subscription.assign', 'company', $id, $data);

        return $sub->load('plan');
    }

    // --- Plans ---
    public function plans()
    {
        return SubscriptionPlan::orderBy('price_monthly')->get();
    }

    public function savePlan(Request $request, ?int $id = null)
    {
        $data = $request->validate([
            'name' => 'required|string|max:80',
            'slug' => 'required|alpha_dash|max:40|unique:subscription_plans,slug'.($id ? ",$id" : ''),
            'price_monthly' => 'required|numeric|min:0',
            'price_yearly' => 'required|numeric|min:0',
            'max_staff' => 'nullable|integer|min:1',
            'max_tables' => 'nullable|integer|min:1',
            'max_branches' => 'required|integer|min:1',
            'features' => 'array',
            'features.*' => 'in:'.implode(',', config('hms.features')),
            'trial_days' => 'required|integer|min:0|max:90',
            'is_active' => 'boolean',
        ]);
        $plan = $id ? tap(SubscriptionPlan::findOrFail($id))->update($data) : SubscriptionPlan::create($data);

        return response()->json($plan, $id ? 200 : 201);
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

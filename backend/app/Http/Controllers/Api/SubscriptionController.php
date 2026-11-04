<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\HotelTable;
use App\Models\Branch;
use App\Models\SubscriptionPayment;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Tenant;
use Illuminate\Http\Request;

class SubscriptionController extends Controller
{
    public function __construct(private SubscriptionService $subs)
    {
    }

    public function current(Request $r)
    {
        $state = $this->subs->state(Tenant::company());

        return $state + [
            'usage' => [
                'staff' => User::inTenant(Tenant::id())->count(),
                'tables' => HotelTable::count(),
                'branches' => Branch::count(),
            ],
        ];
    }

    public function plans()
    {
        return SubscriptionPlan::where('is_active', true)->orderBy('price_monthly')->get();
    }

    public function payments()
    {
        return SubscriptionPayment::where('company_id', Tenant::id())->latest()->get();
    }

    /**
     * Subscribe / renew / upgrade / downgrade.
     * Money movement goes through a gateway; the verified gateway reference is required in production.
     * In local/testing a simulated gateway is accepted so the flow is exercisable end-to-end.
     */
    public function subscribe(Request $r)
    {
        $d = $r->validate([
            'plan_id' => 'required|exists:subscription_plans,id',
            'billing_cycle' => 'required|in:monthly,yearly',
            'gateway_ref' => 'nullable|string|max:120',
        ]);
        $plan = SubscriptionPlan::where('is_active', true)->findOrFail($d['plan_id']);

        // Downgrade guard: current usage must fit within the new plan.
        if ($plan->max_staff !== null && User::inTenant(Tenant::id())->count() > $plan->max_staff) {
            return response()->json(['message' => "You have more staff than the {$plan->name} plan allows ({$plan->max_staff})."], 422);
        }
        if ($plan->max_tables !== null && HotelTable::count() > $plan->max_tables) {
            return response()->json(['message' => "You have more tables than the {$plan->name} plan allows ({$plan->max_tables})."], 422);
        }
        if (Branch::count() > $plan->max_branches) {
            return response()->json(['message' => "You have more branches than the {$plan->name} plan allows ({$plan->max_branches})."], 422);
        }

        // Fail closed: self-service activation is only allowed with the simulated gateway outside
        // production. A real gateway verifier (Razorpay/Stripe webhook) must replace this before launch.
        abort_if(app()->environment('production'), 501, 'Payment gateway is not configured.');

        $sub = $this->subs->activate(Tenant::company(), $plan, $d['billing_cycle'], 'simulated', $d['gateway_ref'] ?? null);
        AuditLog::record('subscription.change', 'subscription', $sub->id, ['plan' => $plan->slug, 'cycle' => $d['billing_cycle']]);

        return response()->json($sub, 201);
    }
}

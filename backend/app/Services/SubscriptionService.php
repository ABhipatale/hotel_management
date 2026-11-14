<?php

namespace App\Services;

use App\Models\Company;
use App\Models\Subscription;
use App\Models\SubscriptionPayment;
use App\Models\SubscriptionPlan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SubscriptionService
{
    /** Subscription granted by the platform admin when a company is created (no payment record). */
    public function grant(Company $company, SubscriptionPlan $plan, string $cycle = 'monthly'): Subscription
    {
        $start = now();

        return Subscription::create([
            'company_id' => $company->id,
            'plan_id' => $plan->id,
            'billing_cycle' => $cycle,
            'status' => 'active',
            'starts_at' => $start,
            'ends_at' => $cycle === 'yearly' ? $start->copy()->addYear() : $start->copy()->addMonth(),
        ]);
    }

    /** Activate / renew / upgrade / downgrade: closes the old subscription and opens a new one. */
    public function activate(Company $company, SubscriptionPlan $plan, string $cycle, ?string $gateway = null, ?string $gatewayRef = null, ?SubscriptionPayment $pending = null): Subscription
    {
        return DB::transaction(function () use ($company, $plan, $cycle, $gateway, $gatewayRef, $pending) {
            if ($pending) {
                // Idempotent: lock the pending row; if already paid (webhook + callback race) return its subscription
                $pending = SubscriptionPayment::whereKey($pending->id)->lockForUpdate()->first();
                if ($pending->status === 'paid' && $pending->subscription_id) {
                    return Subscription::findOrFail($pending->subscription_id)->load('plan');
                }
            }
            $current = $this->current($company);
            // Renewal of the same plan extends from the later of now / current end.
            $start = ($current && $current->plan_id === $plan->id && $current->ends_at->isFuture()) ? $current->ends_at : now();
            $end = $cycle === 'yearly' ? $start->copy()->addYear() : $start->copy()->addMonth();

            if ($current) {
                $current->update(['status' => 'expired', 'ends_at' => min($current->ends_at, now())]);
            }

            $sub = Subscription::create([
                'company_id' => $company->id,
                'plan_id' => $plan->id,
                'billing_cycle' => $cycle,
                'status' => 'active',
                'starts_at' => $start,
                'ends_at' => $end,
            ]);

            if ($pending) {
                // keep the order id in gateway_ref lookups; store the payment id separately in the invoice row
                $pending->forceFill([
                    'subscription_id' => $sub->id,
                    'gateway' => $gateway,
                    'status' => 'paid',
                    'paid_at' => now(),
                ])->save();
            } else {
                SubscriptionPayment::create([
                    'company_id' => $company->id,
                    'subscription_id' => $sub->id,
                    'invoice_no' => 'INV-'.now()->format('Ymd').'-'.strtoupper(Str::random(6)),
                    'amount' => $company->priceFor($plan, $cycle),
                    'billing_cycle' => $cycle,
                    'gateway' => $gateway,
                    'gateway_ref' => $gatewayRef,
                    'status' => 'paid',
                    'paid_at' => now(),
                ]);
            }

            if ($company->status !== 'suspended') {
                $company->forceFill(['status' => 'active'])->save();
            }

            return $sub->load('plan');
        });
    }

    public function current(Company $company): ?Subscription
    {
        return Subscription::where('company_id', $company->id)->latest('ends_at')->latest('id')->first();
    }

    public function state(Company $company): array
    {
        $sub = $this->current($company)?->load('plan');

        return [
            'subscription' => $sub,
            'expired' => ! $sub || $sub->isExpired(),
            // never had a subscription: the customer must purchase one on first login
            'pending' => ! $sub,
            'plan' => $sub?->plan,
        ];
    }
}

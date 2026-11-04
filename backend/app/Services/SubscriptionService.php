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
    public function startTrial(Company $company, SubscriptionPlan $plan): Subscription
    {
        return Subscription::create([
            'company_id' => $company->id,
            'plan_id' => $plan->id,
            'billing_cycle' => 'trial',
            'status' => 'trial',
            'starts_at' => now(),
            'ends_at' => now()->addDays($plan->trial_days),
        ]);
    }

    /** Activate / renew / upgrade / downgrade: closes the old subscription and opens a new one. */
    public function activate(Company $company, SubscriptionPlan $plan, string $cycle, ?string $gateway = null, ?string $gatewayRef = null): Subscription
    {
        return DB::transaction(function () use ($company, $plan, $cycle, $gateway, $gatewayRef) {
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

            SubscriptionPayment::create([
                'company_id' => $company->id,
                'subscription_id' => $sub->id,
                'invoice_no' => 'INV-'.now()->format('Ymd').'-'.strtoupper(Str::random(6)),
                'amount' => $cycle === 'yearly' ? $plan->price_yearly : $plan->price_monthly,
                'gateway' => $gateway,
                'gateway_ref' => $gatewayRef,
                'status' => 'paid',
                'paid_at' => now(),
            ]);

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
            'plan' => $sub?->plan,
        ];
    }
}

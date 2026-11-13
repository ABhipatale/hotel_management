<?php

namespace App\Http\Middleware;

use App\Services\SubscriptionService;
use App\Support\Tenant;
use Closure;
use Illuminate\Http\Request;

/**
 * Resolves the tenant from the authenticated user (server-side identity only),
 * enforces company status and subscription state.
 */
class ResolveTenant
{
    public function __construct(private SubscriptionService $subs)
    {
    }

    public function handle(Request $request, Closure $next)
    {
        Tenant::clear();
        $user = $request->user();

        abort_unless($user && $user->company_id && $user->is_active, 403, 'Account is not active.');

        $company = $user->company;
        abort_if(! $company, 403, 'Company not found.');
        abort_if(in_array($company->status, ['inactive', 'suspended'], true), 403, "Company account is {$company->status}. Contact support.");

        Tenant::set($company);

        // Multi-counter companies: every non-owner is pinned to ONE counter (their own; staff with none stay on the default one),
        // and a disabled counter cannot be used.
        if ($company->multi_counter && $user->role !== 'owner') {
            $counter = $user->branch_id
                ? \App\Models\Branch::find($user->branch_id)
                : \App\Models\Branch::orderByDesc('is_default')->orderBy('id')->first();
            abort_if(! $counter || ! $counter->is_active, 403, 'This counter is disabled. Contact the owner.');
            Tenant::lockBranch((int) $counter->id);
        }
        $request->attributes->set('company', $company);

        $state = $this->subs->state($company);
        $request->attributes->set('plan', $state['plan']);
        $request->attributes->set('subscription', $state['subscription']);
        $request->attributes->set('subscription_expired', $state['expired']);

        $request->attributes->set('subscription_pending', $state['pending']);

        // Purchase-on-first-login companies: nothing works until the owner buys a plan
        if ($state['pending'] && ! $request->is('api/subscription*', 'api/auth/*', 'api/support*')) {
            return response()->json(['message' => 'Please choose a plan to start using the app.', 'code' => 'subscription_required'], 402);
        }

        if ($state['expired']) {
            $policy = config('hms.expiry_policy');
            $isRead = $request->isMethodSafe();
            $allowed = $request->is('api/subscription*', 'api/auth/*', 'api/support*');
            if (! $allowed && ($policy === 'block' || ! $isRead)) {
                return response()->json(['message' => 'Subscription expired. Please renew to continue.', 'code' => 'subscription_expired'], 402);
            }
        }

        try {
            return $next($request);
        } finally {
            Tenant::clear();
        }
    }
}

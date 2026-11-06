<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

/** Plan-based feature gate, e.g. ->middleware('feature:inventory'). */
class RequireFeature
{
    public function handle(Request $request, Closure $next, string $feature)
    {
        if ($feature === 'qr' && ! $request->attributes->get('company')?->qr_enabled) {
            return response()->json(['message' => 'QR ordering is not enabled for your company. Please contact support.', 'code' => 'feature_locked', 'feature' => 'qr'], 403);
        }

        $plan = $request->attributes->get('plan');
        if (! $plan || ! $plan->hasFeature($feature)) {
            return response()->json(['message' => 'Your plan does not include this feature. Please upgrade.', 'code' => 'feature_locked', 'feature' => $feature], 402);
        }

        return $next($request);
    }
}

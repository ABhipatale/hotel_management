<?php

namespace App\Http\Middleware;

use App\Support\Tenant;
use Closure;
use Illuminate\Http\Request;

class SuperAdminOnly
{
    public function handle(Request $request, Closure $next)
    {
        abort_unless($request->user()?->isSuperAdmin(), 403, 'Super admin only.');

        // Platform-level queries are explicitly unscoped for the request duration.
        return Tenant::unscoped(fn () => $next($request));
    }
}

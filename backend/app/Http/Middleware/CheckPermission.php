<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class CheckPermission
{
    public function handle(Request $request, Closure $next, string ...$permissions)
    {
        $user = $request->user();
        foreach ($permissions as $p) {
            if ($user && $user->hasPermission($p)) {
                return $next($request);
            }
        }
        abort(403, 'You do not have permission to do this.');
    }
}

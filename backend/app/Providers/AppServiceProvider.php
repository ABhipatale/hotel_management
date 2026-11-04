<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
    }

    public function boot(): void
    {
        RateLimiter::for('auth', fn (Request $r) => Limit::perMinute(10)->by($r->ip().'|'.strtolower((string) $r->input('email'))));
        RateLimiter::for('register', fn (Request $r) => Limit::perHour(10)->by($r->ip()));
        RateLimiter::for('public-menu', fn (Request $r) => Limit::perMinute(60)->by($r->ip()));
        RateLimiter::for('public-order', fn (Request $r) => Limit::perMinute(10)->by($r->ip().'|'.$r->route('token')));
        RateLimiter::for('api', fn (Request $r) => Limit::perMinute(240)->by($r->user()?->id ?: $r->ip()));
    }
}

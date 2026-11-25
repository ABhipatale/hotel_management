<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\CompanyProvisioner;
use App\Services\SubscriptionService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request)
    {
        $data = $request->validate(['email' => 'required|email', 'password' => 'required|string']);

        $user = User::where('email', $data['email'])->first();
        if (! $user || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'Invalid email or password.']);
        }
        if (! $user->is_active) {
            throw ValidationException::withMessages(['email' => 'Your account has been deactivated.']);
        }
        if ($user->company && in_array($user->company->status, ['inactive', 'suspended'], true)) {
            throw ValidationException::withMessages(['email' => "This company account is {$user->company->status}. Contact support."]);
        }

        $user->forceFill(['last_login_at' => now()])->save();
        AuditLog::record('auth.login', 'user', $user->id, [], $user);

        return $this->session($user);
    }

    public function me(Request $request)
    {
        return $this->sessionPayload($request->user());
    }

    public function logout(Request $request)
    {
        $request->user()->currentAccessToken()->delete();

        return response()->noContent();
    }

    private function session(User $user)
    {
        return response()->json($this->sessionPayload($user, true));
    }

    private function sessionPayload(User $user, bool $withToken = false): array
    {
        $out = [];
        if ($withToken) {
            $out['token'] = $user->createToken('pwa', [$user->isSuperAdmin() ? 'admin' : 'tenant'], now()->addDays(14))->plainTextToken;
        }
        $out['user'] = $user->only('id', 'name', 'email', 'phone', 'role', 'branch_id', 'company_id');
        $out['permissions'] = $user->permissionSlugs();

        if ($user->company_id) {
            $company = $user->company;
            $state = app(SubscriptionService::class)->state($company);
            $out['company'] = $company->only('id', 'uid', 'name', 'slug', 'logo_url', 'icon_url', 'brand_color', 'status', 'phone', 'address', 'gst_number', 'gst_enabled', 'payroll_enabled', 'upi_qr_enabled', 'upi_id', 'upi_name', 'qr_enabled', 'multi_counter', 'parcel_enabled', 'parcel_take_money', 'table_sharing_enabled', 'business_type', 'kot_enabled', 'kot_screen', 'kot_print', 'kot_print_mode', 'use_library_images', 'default_language');
            if ($company->multi_counter && $user->role === 'chef') {
                // a chef: the counters they cook for (one or several)
                $all = \App\Support\Tenant::as($company, fn () => \App\Models\Branch::whereIn('id', $user->counterIds())->orderBy('id')->get(['id', 'name', 'is_default', 'is_active']));
                $out['counters'] = $all->values();
                $out['counter'] = $all->count() === 1 ? $all->first()->only('id', 'name') : null;
            } elseif ($company->multi_counter && $user->role !== 'owner') {
                // Waiter / captain / counter manager: their counters (one or several), counter = the one they land on, exactly as
                // ResolveTenant picks it: the main counter if it is active, else their first active one. Staff with no counter
                // (made before multi-counter was switched on) work on the default counter, as before.
                $counterIds = $user->counterIds();
                $all = \App\Support\Tenant::as($company, fn () => $counterIds
                    ? \App\Models\Branch::whereIn('id', $counterIds)->orderBy('id')->get(['id', 'name', 'is_default', 'is_active'])
                    : \App\Models\Branch::orderByDesc('is_default')->orderBy('id')->limit(1)->get(['id', 'name', 'is_default', 'is_active']));
                $out['counters'] = $all->values();
                $main = $all->first(fn ($b) => $b->id === (int) $user->branch_id && $b->is_active) ?? $all->firstWhere('is_active', true) ?? $all->first();
                $out['counter'] = $main ? $main->only('id', 'name') : null;
            } elseif ($company->multi_counter) {
                // Owner: every counter (for the counter switcher).
                $all = \App\Support\Tenant::as($company, fn () => \App\Models\Branch::orderByDesc('is_default')->orderBy('id')->get(['id', 'name', 'is_default', 'is_active']));
                $out['counters'] = $all->values();
                $out['counter'] = null;
            }
            $out['plan'] = $state['plan'];
            $out['subscription'] = $state['subscription']?->only('status', 'billing_cycle', 'starts_at', 'ends_at');
            $out['subscription_expired'] = $state['expired'];
            $out['subscription_pending'] = $state['pending'];
        }

        return $out;
    }
}

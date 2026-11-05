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
            $out['company'] = $company->only('id', 'uid', 'name', 'slug', 'logo_url', 'icon_url', 'brand_color', 'status', 'phone', 'address', 'gst_number', 'gst_enabled');
            $out['plan'] = $state['plan'];
            $out['subscription'] = $state['subscription']?->only('status', 'billing_cycle', 'starts_at', 'ends_at');
            $out['subscription_expired'] = $state['expired'];
        }

        return $out;
    }
}

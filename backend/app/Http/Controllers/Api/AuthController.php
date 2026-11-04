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

    public function register(Request $request, CompanyProvisioner $provisioner)
    {
        $data = $request->validate([
            'company_name' => 'required|string|max:120',
            'business_name' => 'nullable|string|max:120',
            'owner_name' => 'required|string|max:120',
            'phone' => 'required|string|max:20',
            'email' => 'required|email|max:190|unique:users,email',
            'password' => ['required', 'confirmed', Password::min(8)->letters()->numbers()],
            'address' => 'required|string|max:255',
            'city' => 'required|string|max:80',
            'state' => 'required|string|max:80',
            'pin_code' => 'required|string|max:10',
            'gst_number' => 'nullable|string|max:20',
            'logo' => 'nullable|image|max:2048',
            'plan_id' => 'nullable|integer|exists:subscription_plans,id',
        ]);

        $logo = $request->file('logo')?->store('logos', 'public');
        $plan = ! empty($data['plan_id']) ? SubscriptionPlan::where('is_active', true)->find($data['plan_id']) : null;

        [, $owner] = $provisioner->provision($data, $logo, $plan);
        AuditLog::record('company.registered', 'company', $owner->company_id, [], $owner);

        return response()->json($this->sessionPayload($owner, true), 201);
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
            $out['company'] = $company->only('id', 'uid', 'name', 'slug', 'logo_url', 'icon_url', 'brand_color', 'status', 'phone', 'address', 'gst_number');
            $out['plan'] = $state['plan'];
            $out['subscription'] = $state['subscription']?->only('status', 'billing_cycle', 'starts_at', 'ends_at');
            $out['subscription_expired'] = $state['expired'];
        }

        return $out;
    }
}

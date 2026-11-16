<?php

namespace App\Services;

use App\Support\Tenant;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;

/**
 * The owner may do anything. Everybody else needs the owner's approval PIN (sent in the X-Approval-Pin header) for risky actions:
 * voiding a bill, an extra discount above the staff limit, cancelling an order the kitchen already started.
 * Wrong PINs are throttled, so it cannot be guessed.
 */
class ApprovalService
{
    public const HEADER = 'X-Approval-Pin';

    public static function hasPin(): bool
    {
        return ! empty(Tenant::company()?->approval_pin);
    }

    /** Strict: the owner, or a valid PIN. Returns who approved: 'owner' | 'pin'. */
    public function require(Request $r, string $what): string
    {
        $user = $r->user();
        if ($user->role === 'owner') {
            return 'owner';
        }

        $hash = Tenant::company()?->approval_pin;
        $pin = trim((string) ($r->header(self::HEADER) ?? $r->input('approval_pin', '')));
        if ($hash && $pin !== '') {
            $key = 'approval:'.$user->id;
            if (RateLimiter::tooManyAttempts($key, 5)) {
                throw new HttpResponseException(response()->json(['message' => 'Too many wrong PIN attempts. Try again in a few minutes.', 'code' => 'approval_locked'], 429));
            }
            if (Hash::check($pin, $hash)) {
                RateLimiter::clear($key);

                return 'pin';
            }
            RateLimiter::hit($key, 600);
            $this->deny('Wrong approval PIN.', true);
        }

        $this->deny($hash ? "$what needs the owner's approval PIN." : "$what needs the owner. Ask the owner to set an approval PIN (Settings → Approvals).", (bool) $hash);
    }

    /** Only when the owner has set a PIN: without one the action stays as it always was. Returns who approved, or null. */
    public function requireIfConfigured(Request $r, string $what): ?string
    {
        if ($r->user()->role === 'owner') {
            return 'owner';
        }

        return self::hasPin() ? $this->require($r, $what) : null;
    }

    private function deny(string $message, bool $hasPin): never
    {
        throw new HttpResponseException(response()->json(['message' => $message, 'code' => 'approval_required', 'has_pin' => $hasPin], 403));
    }
}

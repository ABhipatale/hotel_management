<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\HotelTable;
use App\Models\SubscriptionPayment;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\PaymentGateway;
use App\Services\SubscriptionService;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class SubscriptionController extends Controller
{
    public function __construct(private SubscriptionService $subs)
    {
    }

    public function current(Request $r)
    {
        $state = $this->subs->state(Tenant::company());

        return $state + [
            'usage' => [
                'staff' => User::inTenant(Tenant::id())->count(),
                'tables' => HotelTable::count(),
            ],
        ];
    }

    /** Prices of the single subscription. */
    public function pricing()
    {
        $p = SubscriptionPlan::current();

        return ['price_monthly' => (float) $p->price_monthly, 'price_yearly' => (float) $p->price_yearly];
    }

    public function payments()
    {
        return SubscriptionPayment::where('company_id', Tenant::id())->latest()->get();
    }

    /**
     * Step 1 of buying / renewing: creates a pending payment priced from our DB (never from the client)
     * and, with Razorpay configured, a Razorpay order for the checkout popup.
     */
    public function checkout(Request $r, PaymentGateway $gw)
    {
        $d = $r->validate(['billing_cycle' => 'required|in:monthly,yearly']);
        $plan = SubscriptionPlan::current();
        $company = Tenant::company();

        abort_unless($gw->configured() || $gw->simulated(), 503, 'Online payment is not set up yet. Please contact support.');

        $payment = SubscriptionPayment::create([
            'company_id' => $company->id,
            'invoice_no' => 'INV-'.now()->format('Ymd').'-'.strtoupper(Str::random(6)),
            'amount' => $d['billing_cycle'] === 'yearly' ? $plan->price_yearly : $plan->price_monthly,
            'billing_cycle' => $d['billing_cycle'],
            'gateway' => $gw->configured() ? 'razorpay' : 'simulated',
            'status' => 'pending',
        ]);

        if ($gw->simulated()) {
            $payment->update(['gateway_ref' => 'sim_'.Str::random(14)]);

            return ['mode' => 'simulated', 'order_id' => $payment->gateway_ref, 'amount' => (float) $payment->amount];
        }

        try {
            $payment->update(['gateway_ref' => $gw->createOrder($payment, $company)]);
        } catch (\Throwable $e) {
            report($e);
            $payment->update(['status' => 'failed']);
            abort(502, 'Could not start the payment. Please try again.');
        }

        return [
            'mode' => 'razorpay',
            'key_id' => config('services.razorpay.key_id'),
            'order_id' => $payment->gateway_ref,
            'amount' => (float) $payment->amount,
            'amount_paise' => (int) round(((float) $payment->amount) * 100),
            'currency' => 'INR',
            'name' => $company->name,
            'description' => 'Premium - '.$d['billing_cycle'],
            'prefill' => ['name' => $r->user()->name, 'email' => $r->user()->email, 'contact' => $r->user()->phone],
        ];
    }

    /** Step 2: the checkout popup reports success; we verify the signature, then activate. */
    public function confirm(Request $r, PaymentGateway $gw)
    {
        $d = $r->validate([
            'order_id' => 'required|string|max:120',
            'razorpay_payment_id' => 'nullable|string|max:120',
            'razorpay_signature' => 'nullable|string|max:200',
        ]);
        $company = Tenant::company();
        $payment = SubscriptionPayment::where('company_id', $company->id)->where('gateway_ref', $d['order_id'])->firstOrFail();

        if ($payment->status !== 'paid') {
            abort_unless($payment->status === 'pending', 422, 'This payment can no longer be completed.');
            if ($payment->gateway === 'razorpay') {
                abort_unless(
                    $gw->verifySignature($d['order_id'], (string) ($d['razorpay_payment_id'] ?? ''), (string) ($d['razorpay_signature'] ?? '')),
                    422, 'Payment could not be verified.'
                );
            } else {
                abort_unless($gw->simulated(), 422, 'Payment could not be verified.');
            }
        }

        $sub = $this->subs->activate($company, SubscriptionPlan::current(), (string) $payment->billing_cycle, $payment->gateway, $d['razorpay_payment_id'] ?? $d['order_id'], $payment);
        AuditLog::record('subscription.change', 'subscription', $sub->id, ['cycle' => $payment->billing_cycle]);

        return response()->json($sub, 201);
    }
}

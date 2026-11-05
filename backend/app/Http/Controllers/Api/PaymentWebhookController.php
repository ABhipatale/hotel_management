<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Company;
use App\Models\SubscriptionPayment;
use App\Models\SubscriptionPlan;
use App\Services\PaymentGateway;
use App\Services\SubscriptionService;
use Illuminate\Http\Request;

/** Razorpay -> us. Activates a purchase even if the customer closed the browser before the checkout callback. */
class PaymentWebhookController extends Controller
{
    public function razorpay(Request $r, PaymentGateway $gw, SubscriptionService $subs)
    {
        abort_unless($gw->verifyWebhook($r->getContent(), (string) $r->header('X-Razorpay-Signature')), 400, 'Invalid signature.');

        if (in_array($r->input('event'), ['order.paid', 'payment.captured'], true)) {
            $orderId = $r->input('payload.order.entity.id') ?? $r->input('payload.payment.entity.order_id');
            $paymentRef = $r->input('payload.payment.entity.id');
            $paidPaise = $r->input('payload.payment.entity.amount') ?? $r->input('payload.order.entity.amount_paid');

            $payment = $orderId ? SubscriptionPayment::where('gateway', 'razorpay')->where('gateway_ref', $orderId)->first() : null;
            // Only activate if the money received matches what we asked for
            if ($payment && $payment->status === 'pending' && (int) $paidPaise === (int) round(((float) $payment->amount) * 100)) {
                $subs->activate(Company::findOrFail($payment->company_id), SubscriptionPlan::current(), (string) $payment->billing_cycle, 'razorpay', $paymentRef ?: $orderId, $payment);
            }
        }

        // Always 200 for valid signatures so Razorpay does not keep retrying events we ignore
        return response()->json(['ok' => true]);
    }
}

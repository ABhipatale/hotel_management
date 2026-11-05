<?php

namespace App\Services;

use App\Models\Company;
use App\Models\SubscriptionPayment;
use Illuminate\Support\Facades\Http;

/**
 * Razorpay integration for subscription purchases.
 *  - configured(): live keys are present (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET in .env)
 *  - simulated():  no keys AND not production -> instant fake payment for local development / tests
 * In production without keys, purchases are refused (the platform admin can still grant subscriptions).
 */
class PaymentGateway
{
    public function configured(): bool
    {
        return filled(config('services.razorpay.key_id')) && filled(config('services.razorpay.key_secret'));
    }

    public function simulated(): bool
    {
        return ! $this->configured() && ! app()->environment('production');
    }

    /** Creates a Razorpay order for a pending payment and returns its id. The amount always comes from our DB. */
    public function createOrder(SubscriptionPayment $payment, Company $company): string
    {
        $res = Http::withBasicAuth((string) config('services.razorpay.key_id'), (string) config('services.razorpay.key_secret'))
            ->acceptJson()->timeout(15)
            ->post('https://api.razorpay.com/v1/orders', [
                'amount' => (int) round(((float) $payment->amount) * 100), // paise
                'currency' => 'INR',
                'receipt' => $payment->invoice_no,
                'notes' => ['company_id' => (string) $company->id, 'cycle' => (string) $payment->billing_cycle],
            ]);

        if (! $res->successful() || ! $res->json('id')) {
            throw new \RuntimeException('Razorpay order creation failed (HTTP '.$res->status().')');
        }

        return (string) $res->json('id');
    }

    /** Checkout callback signature: HMAC-SHA256(order_id|payment_id, key_secret). */
    public function verifySignature(string $orderId, string $paymentId, string $signature): bool
    {
        $secret = (string) config('services.razorpay.key_secret');
        if ($secret === '' || $orderId === '' || $paymentId === '' || $signature === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $orderId.'|'.$paymentId, $secret), $signature);
    }

    /** Webhook signature: HMAC-SHA256(raw body, webhook_secret). */
    public function verifyWebhook(string $body, string $signature): bool
    {
        $secret = (string) config('services.razorpay.webhook_secret');
        if ($secret === '' || $signature === '') {
            return false;
        }

        return hash_equals(hash_hmac('sha256', $body, $secret), $signature);
    }
}

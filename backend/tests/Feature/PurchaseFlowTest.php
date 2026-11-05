<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\SubscriptionPayment;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** Companies created without a subscription must buy a plan on first login. */
class PurchaseFlowTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
        config(['services.razorpay.key_id' => null, 'services.razorpay.key_secret' => null, 'services.razorpay.webhook_secret' => null]);
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function h(string $email, string $pw): array
    {
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function pendingCompany(): array
    {
        $this->postJson('/api/admin/companies', [
            'company_name' => 'Self Buy', 'owner_name' => 'Sam', 'phone' => '9000000002', 'email' => 'sam@test.dev', 'password' => 'Secret123',
        ], $this->h('admin@hms.test', 'Admin@12345'))->assertCreated();

        return $this->h('sam@test.dev', 'Secret123');
    }

    public function test_company_without_subscription_is_locked_until_purchase(): void
    {
        $o = $this->pendingCompany();

        $login = $this->postJson('/api/auth/login', ['email' => 'sam@test.dev', 'password' => 'Secret123'])->assertOk();
        $login->assertJsonPath('subscription_pending', true)->assertJsonPath('subscription_expired', true)->assertJsonPath('subscription', null);

        $this->getJson('/api/tables', $o)->assertStatus(402)->assertJsonPath('code', 'subscription_required');
        $this->getJson('/api/dashboard', $o)->assertStatus(402)->assertJsonPath('code', 'subscription_required');
        $this->getJson('/api/subscription/pricing', $o)->assertOk();
        $this->getJson('/api/auth/me', $o)->assertOk()->assertJsonPath('subscription_pending', true);

        $order = $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'yearly'], $o)->assertOk()->assertJsonPath('mode', 'simulated')->json('order_id');
        $this->postJson('/api/subscription/confirm', ['order_id' => $order], $o)->assertCreated()->assertJsonPath('billing_cycle', 'yearly');

        $this->getJson('/api/tables', $o)->assertOk();
        $this->getJson('/api/auth/me', $o)->assertJsonPath('subscription_pending', false)->assertJsonPath('subscription_expired', false);
        $this->assertSame(1, SubscriptionPayment::where('status', 'paid')->where('billing_cycle', 'yearly')->count());

        // confirming twice does not extend again
        $this->postJson('/api/subscription/confirm', ['order_id' => $order], $o)->assertCreated();
        $this->assertSame(1, \App\Models\Subscription::where('company_id', Company::where('slug', 'self-buy')->value('id'))->count());
    }

    public function test_admin_can_still_create_company_with_subscription(): void
    {
        $this->postJson('/api/admin/companies', [
            'company_name' => 'Pre Paid', 'owner_name' => 'Pat', 'phone' => '9000000003', 'email' => 'pat@test.dev', 'password' => 'Secret123', 'billing_cycle' => 'monthly',
        ], $this->h('admin@hms.test', 'Admin@12345'))->assertCreated();
        $this->postJson('/api/auth/login', ['email' => 'pat@test.dev', 'password' => 'Secret123'])->assertJsonPath('subscription_pending', false);
    }

    public function test_other_company_cannot_confirm_someone_elses_order(): void
    {
        $o = $this->pendingCompany();
        $order = $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'monthly'], $o)->assertOk()->json('order_id');

        $atithi = $this->h('atithi@demo.test', 'Demo@12345');
        $this->postJson('/api/subscription/confirm', ['order_id' => $order], $atithi)->assertNotFound();
    }

    public function test_production_without_keys_refuses_checkout(): void
    {
        $o = $this->pendingCompany();
        $this->app['env'] = 'production';
        $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'monthly'], $o)->assertStatus(503);
    }

    public function test_razorpay_signature_is_verified_and_webhook_activates(): void
    {
        config(['services.razorpay.key_id' => 'rzp_test_x', 'services.razorpay.key_secret' => 'sekret', 'services.razorpay.webhook_secret' => 'whsec']);
        Http::fake(['api.razorpay.com/*' => Http::response(['id' => 'order_ABC123'], 200)]);
        $o = $this->pendingCompany();

        $co = $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'monthly'], $o)->assertOk()->assertJsonPath('mode', 'razorpay')->assertJsonPath('order_id', 'order_ABC123');
        $this->assertGreaterThan(0, $co->json('amount_paise'));

        // wrong signature -> rejected, still locked
        $this->postJson('/api/subscription/confirm', ['order_id' => 'order_ABC123', 'razorpay_payment_id' => 'pay_1', 'razorpay_signature' => 'bad'], $o)->assertStatus(422);
        $this->getJson('/api/tables', $o)->assertStatus(402);

        // webhook with a bad signature
        $body = json_encode(['event' => 'order.paid', 'payload' => ['payment' => ['entity' => ['id' => 'pay_1', 'order_id' => 'order_ABC123', 'amount' => $co->json('amount_paise')]]]]);
        $this->call('POST', '/api/webhooks/razorpay', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_RAZORPAY_SIGNATURE' => 'nope'], $body)->assertStatus(400);

        // wrong amount is ignored
        $wrong = str_replace((string) $co->json('amount_paise'), '100', $body);
        $this->call('POST', '/api/webhooks/razorpay', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_RAZORPAY_SIGNATURE' => hash_hmac('sha256', $wrong, 'whsec')], $wrong)->assertOk();
        $this->getJson('/api/tables', $o)->assertStatus(402);

        // valid webhook activates even though the browser never called confirm
        $this->call('POST', '/api/webhooks/razorpay', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_X_RAZORPAY_SIGNATURE' => hash_hmac('sha256', $body, 'whsec')], $body)->assertOk();
        $this->getJson('/api/tables', $o)->assertOk();

        // late callback with a valid signature is idempotent
        $sig = hash_hmac('sha256', 'order_ABC123|pay_1', 'sekret');
        $this->postJson('/api/subscription/confirm', ['order_id' => 'order_ABC123', 'razorpay_payment_id' => 'pay_1', 'razorpay_signature' => $sig], $o)->assertCreated();
        $this->assertSame(1, SubscriptionPayment::where('status', 'paid')->count());
    }
}

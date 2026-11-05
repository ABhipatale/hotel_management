<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\FoodItem;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** GST can be switched on/off per company by the platform admin. */
class GstToggleTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    /** The Sanctum guard memoises the user inside one test process; reset it per request. */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function h(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function admin(): array
    {
        return $this->h('admin@hms.test', 'Admin@12345');
    }

    private function newCompany(bool $gst, ?string $gstNumber = '27ABCDE1234F1Z5'): array
    {
        $this->postJson('/api/admin/companies', [
            'company_name' => 'Chai Corner', 'owner_name' => 'Chai', 'phone' => '9000000001', 'email' => 'chai@test.dev', 'password' => 'Secret123',
            'billing_cycle' => 'monthly', 'gst_enabled' => $gst, 'gst_number' => $gstNumber,
        ], $this->admin())->assertCreated();

        return $this->h('chai@test.dev', 'Secret123');
    }

    private function dish(array $h, string $name = 'Masala Chai', float $price = 100): array
    {
        $cat = $this->getJson('/api/menu/categories', $h)->assertOk()->json('0.id');

        return $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => $name, 'price' => $price, 'gst_percent' => 18], $h)->assertCreated()->json();
    }

    private function company(string $name): Company
    {
        return Tenant::unscoped(fn () => Company::where('name', $name)->firstOrFail());
    }

    public function test_company_created_with_gst_off_has_no_gst_anywhere(): void
    {
        $o = $this->newCompany(false);
        $c = $this->company('Chai Corner');
        $this->assertFalse($c->gst_enabled);
        $this->assertNull($c->gst_number); // the number is not stored while GST is off

        $this->postJson('/api/auth/login', ['email' => 'chai@test.dev', 'password' => 'Secret123'])->assertOk()->assertJsonPath('company.gst_enabled', false);

        $dish = $this->dish($o);
        $order = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $dish['id'], 'quantity' => 2]]], $o)->assertCreated();
        $this->assertEquals(0, $order->json('items.0.gst_percent'));
        $this->assertEquals(0, $order->json('bill.tax'));
        $this->assertEquals(200, $order->json('bill.grand_total')); // exactly subtotal, no GST added
        $this->assertEquals(0, $order->json('bill.items.0.tax'));

        $receipt = $this->getJson('/api/bills/'.$order->json('bill.id'), $o)->assertOk();
        $receipt->assertJsonPath('company.gst_enabled', false)->assertJsonPath('company.gst_number', null);
    }

    public function test_gst_fields_are_locked_for_the_owner_while_off(): void
    {
        $o = $this->newCompany(false, null);
        $this->post('/api/company', ['gst_number' => '27ZZZZZ9999Z1Z1'], $o + ['Accept' => 'application/json'])->assertOk();
        $this->assertNull($this->company('Chai Corner')->gst_number);

        // The dish GST % cannot be changed while GST is off either (stays at the stored value)
        $dish = $this->dish($o);
        $stored = collect($this->getJson('/api/menu/items', $o)->json())->firstWhere('id', $dish['id']);
        $this->assertEquals(5, $stored['gst_percent']); // 18 was sent, ignored
    }

    public function test_only_super_admin_can_switch_gst_and_it_takes_effect_immediately(): void
    {
        $o = $this->h('atithi@demo.test');
        $a = $this->company('Hotel Atithi');
        $this->assertTrue($a->gst_enabled);

        // An owner cannot switch it off for themselves
        $this->post('/api/company', ['gst_enabled' => false], $o + ['Accept' => 'application/json'])->assertOk();
        $this->assertTrue($this->company('Hotel Atithi')->gst_enabled);

        // Order taken while GST is on...
        $item = $this->getJson('/api/menu/items', $o)->json('0');
        $order = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $o)->assertCreated();
        $this->assertGreaterThan(0, (float) $order->json('items.0.gst_percent'));

        // ...admin turns GST off before it is billed: the bill carries no tax
        $this->putJson("/api/admin/companies/{$a->id}", ['gst_enabled' => false], $this->admin())->assertOk()->assertJsonPath('gst_enabled', false);
        $bill = $this->postJson('/api/orders/'.$order->json('id').'/bill', [], $o)->assertCreated();
        $this->assertEquals(0, $bill->json('tax'));
        $this->assertEqualsWithDelta($item['price'] * (1 - $item['discount_percent'] / 100), (float) $bill->json('grand_total'), 0.01);

        // Back on: the stored GSTIN is still there and new bills charge GST again
        $this->putJson("/api/admin/companies/{$a->id}", ['gst_enabled' => true, 'gst_number' => '27NEWNUM1234Z5'], $this->admin())->assertOk()
            ->assertJsonPath('gst_enabled', true)->assertJsonPath('gst_number', '27NEWNUM1234Z5');
        $order2 = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $o)->assertCreated();
        $this->assertGreaterThan(0, (float) $order2->json('bill.tax'));

        // Owners cannot reach the admin endpoint
        $this->putJson("/api/admin/companies/{$a->id}", ['gst_enabled' => false], $o)->assertForbidden();
    }

    public function test_gst_number_edit_is_ignored_by_admin_update_while_off(): void
    {
        $this->newCompany(true);
        $c = $this->company('Chai Corner');
        $this->assertSame('27ABCDE1234F1Z5', $c->gst_number);

        // turning off keeps the stored number untouched even if a new one is sent in the same request
        $this->putJson("/api/admin/companies/{$c->id}", ['gst_enabled' => false, 'gst_number' => 'CHANGED'], $this->admin())->assertOk();
        $this->assertSame('27ABCDE1234F1Z5', $this->company('Chai Corner')->gst_number);
    }

    public function test_payment_can_be_split_but_not_over_or_under_the_bill(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->getJson('/api/menu/items', $w)->json('0');
        $bill = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $item['id'], 'quantity' => 2]]], $w)->assertCreated()->json('bill');
        $total = (float) $bill['grand_total'];

        $this->postJson("/api/bills/{$bill['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => $total + 50]]], $w)->assertStatus(422); // over
        $this->postJson("/api/bills/{$bill['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => $total - 1]]], $w)->assertStatus(422); // under

        $cash = round($total / 2, 2);
        $this->postJson("/api/bills/{$bill['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => $cash], ['method' => 'upi', 'amount' => round($total - $cash, 2), 'reference' => 'UPI123']]], $w)
            ->assertOk()->assertJsonCount(2, 'bill.payments');
    }
}

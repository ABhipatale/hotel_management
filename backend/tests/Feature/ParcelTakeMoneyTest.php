<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Parcel "Take money?" popup (company flag parcel_take_money, switched on by the platform admin).
 * The popup itself is in the app (NewOrder.jsx); the server side is the flag, and the bill made from the popup:
 * paid at once (Cash / UPI) or printed unpaid (with the UPI QR when that is on, and the customer's name).
 */
class ParcelTakeMoneyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function h(string $email, string $password = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $password])->assertOk()->json('token')];
    }

    private function companyId(): int
    {
        return Tenant::unscoped(fn () => Company::where('slug', 'hotel-atithi')->value('id'));
    }

    public function test_it_is_off_by_default_and_only_the_platform_admin_switches_it(): void
    {
        $owner = $this->h('atithi@demo.test');
        $this->getJson('/api/auth/me', $owner)->assertOk()->assertJsonPath('company.parcel_take_money', false);

        // the owner cannot switch it on from Settings
        $this->postJson('/api/company', ['parcel_take_money' => true], $owner)->assertOk();
        $this->assertFalse((bool) Tenant::unscoped(fn () => Company::find($this->companyId())->parcel_take_money));

        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['parcel_take_money' => true], $admin)->assertOk()->assertJsonPath('parcel_take_money', true);
        $this->getJson('/api/auth/me', $owner)->assertOk()->assertJsonPath('company.parcel_take_money', true);

        // saving other details without the field leaves it as it is
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['city' => 'Pune'], $admin)->assertOk()->assertJsonPath('parcel_take_money', true);
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['parcel_take_money' => false], $admin)->assertOk()->assertJsonPath('parcel_take_money', false);
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['parcel_take_money' => 'yes please'], $admin)->assertStatus(422);
    }

    public function test_a_new_company_gets_it_only_when_asked(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $base = ['owner_name' => 'Owner', 'password' => 'Secret@123', 'city' => 'Pune'];
        $off = $this->postJson('/api/admin/companies', $base + ['company_name' => 'Plain Hotel', 'email' => 'plain@x.test', 'phone' => '9000000001'], $admin)->assertCreated()->json();
        $on = $this->postJson('/api/admin/companies', $base + ['company_name' => 'Parcel Hotel', 'email' => 'parcel@x.test', 'phone' => '9000000002', 'parcel_enabled' => true, 'parcel_take_money' => true], $admin)->assertCreated()->json();
        $this->assertFalse((bool) Tenant::unscoped(fn () => Company::find($off['id'])->parcel_take_money));
        $this->assertTrue((bool) Tenant::unscoped(fn () => Company::find($on['id'])->parcel_take_money));
    }

    public function test_not_paid_prints_an_unpaid_bill_with_the_qr_and_paid_prints_a_paid_bill(): void
    {
        Tenant::unscoped(fn () => Company::where('id', $this->companyId())->update(['parcel_enabled' => true, 'parcel_take_money' => true, 'upi_qr_enabled' => true]));
        $owner = $this->h('atithi@demo.test');
        $this->postJson('/api/company', ['upi_id' => 'hotel@okbank'], $owner)->assertOk();
        $cat = $this->getJson('/api/menu/categories', $owner)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Parcel Thali', 'price' => 120, 'gst_percent' => 5], $owner)->assertCreated()->json();
        $p1 = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertCreated()->json();
        $p2 = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '2', 'capacity' => 1], $owner)->assertCreated()->json();

        // Not paid · Print bill: the bill is made with the customer's name, stays unpaid, and carries the UPI id for the QR
        $o1 = $this->postJson('/api/orders', ['table_id' => $p1['id'], 'type' => 'takeaway', 'items' => [['food_item_id' => $dish['id'], 'quantity' => 2]]], $owner)->assertCreated()->json();
        $b1 = $this->postJson("/api/orders/{$o1['id']}/bill", ['customer_name' => '  Ramesh  '], $owner)->assertCreated()->json();
        $this->assertArrayNotHasKey('status', $b1); // a new bill's answer has no status: the app must treat "not paid" as anything but 'paid'
        $this->getJson("/api/bills/{$b1['id']}", $owner)->assertOk()
            ->assertJsonPath('bill.status', 'unpaid')
            ->assertJsonPath('customer_name', 'Ramesh')
            ->assertJsonPath('company.upi_id', 'hotel@okbank');
        // the same tap again (a retry) returns the same bill, never a second one
        $this->postJson("/api/orders/{$o1['id']}/bill", [], $owner)->assertCreated()->assertJsonPath('id', $b1['id']);
        $this->getJson('/api/bills?status=unpaid', $owner)->assertOk()->assertJsonFragment(['bill_no' => $b1['bill_no']]);

        // Cash received · Print bill: the bill is made and paid in full at once; the paid bill is what gets printed (the app shows no QR on it)
        $o2 = $this->postJson('/api/orders', ['table_id' => $p2['id'], 'type' => 'takeaway', 'items' => [['food_item_id' => $dish['id'], 'quantity' => 1]]], $owner)->assertCreated()->json();
        $b2 = $this->postJson("/api/orders/{$o2['id']}/bill", ['customer_name' => 'Sita'], $owner)->assertCreated()->json();
        $paid = $this->postJson("/api/bills/{$b2['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => (float) $b2['grand_total']]], 'customer_name' => 'Sita'], $owner)->assertOk();
        $paid->assertJsonPath('bill.status', 'paid')->assertJsonPath('customer_name', 'Sita')->assertJsonPath('bill.payments.0.method', 'cash');
        $this->assertSame(126.0, (float) $paid->json('bill.grand_total')); // 120 + 5% GST, worked out by the server
        $this->assertSame('available', $this->getJson('/api/tables', $owner)->collect()->firstWhere('id', $p2['id'])['status']); // the parcel is free again

        // a paid order's name is not changed by a late bill request
        $this->postJson("/api/orders/{$o2['id']}/bill", ['customer_name' => 'Someone else'], $owner)->assertCreated();
        $this->getJson("/api/bills/{$b2['id']}", $owner)->assertOk()->assertJsonPath('customer_name', 'Sita');
    }

    public function test_a_captain_cannot_make_or_pay_the_bill(): void
    {
        Tenant::unscoped(fn () => Company::where('id', $this->companyId())->update(['parcel_enabled' => true, 'parcel_take_money' => true]));
        $owner = $this->h('atithi@demo.test');
        $cat = $this->getJson('/api/menu/categories', $owner)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Parcel Tea', 'price' => 20], $owner)->assertCreated()->json();
        $p1 = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertCreated()->json();
        $this->postJson('/api/staff', ['name' => 'Ravi Captain', 'email' => 'ravi@atithi.test', 'password' => '123456', 'role' => 'captain'], $owner)->assertCreated();
        $cap = $this->h('ravi@atithi.test', '123456');
        // the app shows a captain the plain kitchen-slip popup; the server refuses the bill anyway
        $order = $this->postJson('/api/orders', ['table_id' => $p1['id'], 'type' => 'takeaway', 'items' => [['food_item_id' => $dish['id'], 'quantity' => 1]]], $cap)->assertCreated()->json();
        $this->postJson("/api/orders/{$order['id']}/bill", ['customer_name' => 'X'], $cap)->assertForbidden();
        $this->assertNull(Tenant::unscoped(fn () => \App\Models\Order::find($order['id'])->customer_name));
    }
}

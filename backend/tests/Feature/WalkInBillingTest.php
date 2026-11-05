<?php

namespace Tests\Feature;

use App\Models\HotelTable;
use App\Models\Order;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Orders and bills without a table (walk-in / takeaway / delivery / counter sale). */
class WalkInBillingTest extends TestCase
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

    private function h(string $email): array
    {
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    private function item(array $h): array
    {
        return $this->getJson('/api/menu/items', $h)->assertOk()->json('0');
    }

    private function tableStatuses(): array
    {
        return Tenant::unscoped(fn () => HotelTable::orderBy('id')->pluck('status', 'id')->all());
    }

    public function test_waiter_can_create_an_order_without_a_table_and_bill_it_in_one_step(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->item($w);
        $before = $this->tableStatuses();

        $res = $this->postJson('/api/orders', [
            'type' => 'takeaway',
            'generate_bill' => true,
            'items' => [['food_item_id' => $item['id'], 'quantity' => 2, 'price' => 1]], // client price is ignored
        ], $w)->assertCreated();

        $res->assertJsonPath('table_id', null)->assertJsonPath('type', 'takeaway');
        $expected = round($item['price'] * 2 * (1 + $item['gst_percent'] / 100), 2);
        $this->assertEqualsWithDelta($expected, (float) $res->json('bill.grand_total'), 0.01);
        $this->assertSame('unpaid', $res->json('bill.status'));
        $this->assertSame($before, $this->tableStatuses()); // no table was touched

        $billId = $res->json('bill.id');
        $receipt = $this->getJson("/api/bills/$billId", $w)->assertOk();
        $receipt->assertJsonPath('table', null)->assertJsonPath('order_no', $res->json('order_no'));

        $this->postJson("/api/bills/$billId/pay", ['payments' => [['method' => 'cash', 'amount' => $expected]]], $w)->assertOk();
        $this->assertSame('paid', Tenant::unscoped(fn () => Order::find($res->json('id'))->status));
        $this->assertSame($before, $this->tableStatuses());
    }

    public function test_dine_in_without_a_table_is_stored_as_takeaway(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->item($w);
        $this->postJson('/api/orders', ['type' => 'dine_in', 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $w)
            ->assertCreated()->assertJsonPath('type', 'takeaway')->assertJsonPath('table_id', null);
        // no type at all behaves the same
        $this->postJson('/api/orders', ['items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $w)
            ->assertCreated()->assertJsonPath('type', 'takeaway');
    }

    public function test_table_less_order_can_be_billed_later_from_the_orders_screen(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->item($w);
        $order = $this->postJson('/api/orders', ['type' => 'delivery', 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $w)->assertCreated();
        $this->assertNull($order->json('bill')); // not billed unless asked

        $this->postJson('/api/orders/'.$order->json('id').'/bill', [], $w)->assertCreated();
    }

    public function test_table_orders_still_work_and_free_the_table_after_payment(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->item($w);
        $tableId = Tenant::unscoped(fn () => HotelTable::where('company_id', \App\Models\Company::where('name', 'Hotel Atithi')->value('id'))->value('id'));

        $order = $this->postJson('/api/orders', ['table_id' => $tableId, 'generate_bill' => true, 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $w)->assertCreated();
        $order->assertJsonPath('type', 'dine_in');
        $this->assertSame('billing', Tenant::unscoped(fn () => HotelTable::find($tableId)->status));

        $bill = $order->json('bill');
        $this->postJson("/api/bills/{$bill['id']}/pay", ['payments' => [['method' => 'upi', 'amount' => $bill['grand_total']]]], $w)->assertOk();
        $this->assertSame('available', Tenant::unscoped(fn () => HotelTable::find($tableId)->status));
    }

    public function test_other_companies_cannot_see_or_pay_a_table_less_bill(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        $item = $this->item($w);
        $res = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $item['id'], 'quantity' => 1]]], $w)->assertCreated();
        $billId = $res->json('bill.id');

        $f = $this->h('friends@demo.test');
        $this->getJson("/api/bills/$billId", $f)->assertNotFound();
        $this->postJson("/api/bills/$billId/pay", ['payments' => [['method' => 'cash', 'amount' => 9999]]], $f)->assertNotFound();
        $this->assertCount(0, $this->getJson('/api/orders', $f)->json());
    }
}

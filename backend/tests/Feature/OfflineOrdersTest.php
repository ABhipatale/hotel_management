<?php

namespace Tests\Feature;

use App\Models\Bill;
use App\Models\Order;
use App\Models\OrderItem;
use App\Support\Tenant;
use Carbon\Carbon;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Orders taken while the device was offline are sent later (and retried): never twice, and on the right time. */
class OfflineOrdersTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function login(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function body(array $h, array $extra = []): array
    {
        return $extra + ['items' => [['food_item_id' => $this->getJson('/api/menu/items', $h)->json('0.id'), 'quantity' => 2]]];
    }

    public function test_the_same_offline_order_sent_twice_is_created_once(): void
    {
        $owner = $this->login('atithi@demo.test');
        $body = $this->body($owner, ['client_ref' => 'dev1-aaaa-0001']);

        $before = Order::withoutGlobalScopes()->count();
        $first = $this->postJson('/api/orders', $body, $owner)->assertCreated()->json();
        $again = $this->postJson('/api/orders', $body, $owner)->assertOk()->assertJsonPath('duplicate', true)->json();   // 200, not 201

        $this->assertSame($first['id'], $again['id']);
        $this->assertSame($first['order_no'], $again['order_no']);
        $this->assertSame($before + 1, Order::withoutGlobalScopes()->count());   // exactly one new order
        $this->assertSame(2, (int) OrderItem::withoutGlobalScopes()->where('order_id', $first['id'])->sum('quantity'));   // the dishes were not doubled
    }

    public function test_an_offline_sale_with_a_bill_is_billed_once_even_if_the_first_try_stopped_early(): void
    {
        $owner = $this->login('atithi@demo.test');
        $ref = 'dev1-bbbb-0002';

        // first try: only the order reached the server (no bill requested)
        $order = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => $ref]), $owner)->assertCreated()->json();
        $this->assertNull(Bill::withoutGlobalScopes()->where('order_id', $order['id'])->first());

        // retry asks for the bill: it is made now, once
        $r1 = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => $ref, 'generate_bill' => true]), $owner)->assertOk()->json();
        $r2 = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => $ref, 'generate_bill' => true]), $owner)->assertOk()->json();
        $this->assertNotNull($r1['bill']['bill_no']);
        $this->assertSame($r1['bill']['bill_no'], $r2['bill']['bill_no']);
        $this->assertSame(1, Bill::withoutGlobalScopes()->where('order_id', $order['id'])->count());
    }

    public function test_a_retry_that_merged_into_an_open_table_order_does_not_add_the_dishes_again(): void
    {
        $owner = $this->login('atithi@demo.test');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $first = $this->postJson('/api/orders', $this->body($owner, ['table_id' => $table, 'type' => 'dine_in']), $owner)->assertCreated()->json();
        $before = (int) OrderItem::withoutGlobalScopes()->where('order_id', $first['id'])->sum('quantity');

        $body = $this->body($owner, ['table_id' => $table, 'type' => 'dine_in', 'client_ref' => 'dev1-cccc-0003']);
        $m1 = $this->postJson('/api/orders', $body, $owner)->json();       // merges into the open order
        $m2 = $this->postJson('/api/orders', $body, $owner)->assertOk()->json();
        $this->assertSame($m1['id'], $m2['id']);
        $this->assertSame($before + 2, (int) OrderItem::withoutGlobalScopes()->where('order_id', $m1['id'])->sum('quantity')); // added once, not twice
    }

    public function test_an_offline_order_keeps_the_time_it_was_really_taken_if_believable(): void
    {
        $owner = $this->login('atithi@demo.test');
        Carbon::setTestNow(Carbon::parse('2026-11-16 10:00:00', 'UTC'));
        $when = '2026-11-16 07:30:00';

        $o = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => 'dev1-dddd-0004', 'generate_bill' => true, 'client_time' => $when.'Z']), $owner)->assertCreated()->json();
        $this->assertSame($when, Order::withoutGlobalScopes()->find($o['id'])->created_at->utc()->format('Y-m-d H:i:s'));
        $this->assertSame($when, Bill::withoutGlobalScopes()->find($o['bill']['id'])->created_at->utc()->format('Y-m-d H:i:s'));

        // a clock in the future, or from days ago, is ignored: the money stays on the real day
        $future = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => 'dev1-eeee-0005', 'client_time' => '2026-11-17 10:00:00Z']), $owner)->assertCreated()->json();
        $old = $this->postJson('/api/orders', $this->body($owner, ['client_ref' => 'dev1-ffff-0006', 'client_time' => '2026-11-10 10:00:00Z']), $owner)->assertCreated()->json();
        $this->assertSame('2026-11-16 10:00:00', Order::withoutGlobalScopes()->find($future['id'])->created_at->utc()->format('Y-m-d H:i:s'));
        $this->assertSame('2026-11-16 10:00:00', Order::withoutGlobalScopes()->find($old['id'])->created_at->utc()->format('Y-m-d H:i:s'));
    }

    public function test_references_belong_to_one_company(): void
    {
        $a = $this->login('atithi@demo.test');
        $b = $this->login('friends@demo.test');
        $ref = 'same-ref-0001';
        $oa = $this->postJson('/api/orders', $this->body($a, ['client_ref' => $ref]), $a)->assertCreated()->json();
        $ob = $this->postJson('/api/orders', $this->body($b, ['client_ref' => $ref]), $b)->assertCreated()->json();   // another hotel: its own order
        $this->assertNotSame($oa['id'], $ob['id']);
    }
}

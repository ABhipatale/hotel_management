<?php

namespace Tests\Feature;

use App\Models\FoodItem;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** An order stays editable until it is paid; an unpaid bill follows the edit. */
class OrderEditTest extends TestCase
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

    private function h(string $email): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    private function dishes(array $h): array
    {
        return collect($this->getJson('/api/menu/items', $h)->json())->take(3)->pluck('id')->all();
    }

    public function test_quantities_removals_and_new_dishes_can_be_changed_before_billing(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        [$a, $b, $c] = $this->dishes($w);
        $order = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $a, 'quantity' => 2], ['food_item_id' => $b, 'quantity' => 1]]], $w)->assertCreated()->json();

        // dish A 2 -> 3, dish B removed, dish C added
        $res = $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 3], ['food_item_id' => $c, 'quantity' => 1]]], $w)->assertOk();
        $active = collect($res->json('items'))->where('status', '!=', 'cancelled');
        $this->assertSame([$a => 3, $c => 1], $active->pluck('quantity', 'food_item_id')->all());
        $this->assertSame('cancelled', collect($res->json('items'))->firstWhere('food_item_id', $b)['status']);

        // an order needs at least one dish
        $this->putJson("/api/orders/{$order['id']}/items", ['items' => []], $w)->assertStatus(422);
    }

    public function test_a_billed_but_unpaid_order_can_still_be_edited_and_its_bill_follows(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        [$a, $b] = $this->dishes($w);
        $order = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $a, 'quantity' => 1]]], $w)->assertCreated()->json();
        $bill = $order['bill'];

        $res = $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 2], ['food_item_id' => $b, 'quantity' => 1]]], $w)->assertOk();
        $newBill = $res->json('bill');
        $this->assertSame($bill['id'], $newBill['id']);           // same bill ...
        $this->assertSame($bill['bill_no'], $newBill['bill_no']); // ... same number
        $this->assertGreaterThan((float) $bill['grand_total'], (float) $newBill['grand_total']);
        $this->assertCount(2, $newBill['items']);
        $this->assertSame('unpaid', $newBill['status']);

        // pay it: now it is closed for edits
        $this->postJson("/api/bills/{$bill['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => $newBill['grand_total']]]], $w)->assertOk();
        $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 5]]], $w)->assertStatus(422);
    }

    public function test_tracked_stock_follows_the_edit_and_other_hotels_cannot_edit(): void
    {
        $w = $this->h('waiter.atithi@demo.test');
        [$a] = $this->dishes($w);
        Tenant::unscoped(fn () => FoodItem::withoutGlobalScopes()->where('id', $a)->update(['stock' => 10]));
        $order = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $a, 'quantity' => 4]]], $w)->assertCreated()->json();
        $stock = fn () => Tenant::unscoped(fn () => FoodItem::withoutGlobalScopes()->find($a)->stock);
        $this->assertSame(6, $stock());

        $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 1]]], $w)->assertOk();
        $this->assertSame(9, $stock());                                   // 3 given back
        $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 12]]], $w)->assertStatus(422); // only 10 in total
        $this->assertSame(9, $stock());

        $other = $this->h('friends@demo.test');
        $this->putJson("/api/orders/{$order['id']}/items", ['items' => [['food_item_id' => $a, 'quantity' => 1]]], $other)->assertNotFound();
    }
}

<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Captain login, table sections and the live new-order feed for the owner / billing counter. */
class CaptainTest extends TestCase
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

    private function login(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function captain(array $owner): array
    {
        $this->postJson('/api/staff', ['name' => 'Ravi Captain', 'email' => 'ravi@atithi.test', 'password' => '123456', 'role' => 'captain'], $owner)->assertCreated()->assertJsonPath('role', 'captain');

        return $this->login('ravi@atithi.test', '123456');
    }

    public function test_captain_takes_orders_but_cannot_bill_or_see_other_peoples_orders(): void
    {
        $owner = $this->login('atithi@demo.test');
        $cap = $this->captain($owner);
        $me = $this->getJson('/api/auth/me', $cap)->json();
        $perms = $me['permissions'] ?? [];
        $this->assertContains('orders.create', $perms);
        $this->assertNotContains('billing.manage', $perms);

        $dish = $this->getJson('/api/menu/items', $cap)->assertOk()->json('0.id');
        $mine = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $cap)->assertCreated()->json();
        $theirs = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $this->login('waiter.atithi@demo.test'))->assertCreated()->json();

        // only their own orders are listed, and only their own can be edited
        $this->assertSame([$mine['id']], collect($this->getJson('/api/orders', $cap)->json())->pluck('id')->all());
        $this->putJson("/api/orders/{$mine['id']}/items", ['items' => [['food_item_id' => $dish, 'quantity' => 2]]], $cap)->assertOk();
        $this->putJson("/api/orders/{$theirs['id']}/items", ['items' => [['food_item_id' => $dish, 'quantity' => 2]]], $cap)->assertForbidden();

        // no billing for a captain
        $this->postJson("/api/orders/{$mine['id']}/bill", [], $cap)->assertForbidden();
        $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $cap)->assertForbidden();
        $this->getJson('/api/orders/feed', $cap)->assertForbidden();
    }

    public function test_owner_gets_a_live_feed_of_orders_placed_by_others_with_table_and_section(): void
    {
        $owner = $this->login('atithi@demo.test');
        $cap = $this->captain($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0');
        $this->putJson("/api/tables/{$table['id']}", ['section' => 'Garden'], $owner)->assertOk()->assertJsonPath('section', 'Garden');
        $dish = $this->getJson('/api/menu/items', $owner)->json('0.id');

        // opening the app: only the newest id, no alerts for old orders
        $base = $this->getJson('/api/orders/feed', $owner)->assertOk();
        $this->assertSame([], $base->json('orders'));
        $after = $base->json('latest_id');

        $this->postJson('/api/orders', ['table_id' => $table['id'], 'items' => [['food_item_id' => $dish, 'quantity' => 2]]], $cap)->assertCreated();
        $feed = $this->getJson("/api/orders/feed?after=$after", $owner)->assertOk();
        $o = $feed->json('orders.0');
        $this->assertSame($table['number'], $o['table']);
        $this->assertSame('Garden', $o['section']);
        $this->assertSame('captain', $o['by_role']);
        $this->assertSame('Ravi Captain', $o['by']);
        $this->assertSame(2, $o['items_count']);

        // nothing new after that point, and the owner's own orders never alert the owner
        $this->assertSame([], $this->getJson('/api/orders/feed?after='.$feed->json('latest_id'), $owner)->json('orders'));
        $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $owner)->assertCreated();
        $this->assertSame([], $this->getJson('/api/orders/feed?after='.$feed->json('latest_id'), $owner)->json('orders'));

        // the order list carries the table section and who placed it (for the Captain badge)
        $row = collect($this->getJson('/api/orders', $owner)->json())->firstWhere('table_id', $table['id']);
        $this->assertSame('Garden', $row['table']['section']);
        $this->assertSame('captain', $row['waiter']['role']);
    }
}

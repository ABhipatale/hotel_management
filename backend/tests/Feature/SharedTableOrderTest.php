<?php

namespace Tests\Feature;

use App\Models\HotelTable;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** One open order per table: waiters / captains add to the same order and each item remembers who added it. */
class SharedTableOrderTest extends TestCase
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

    private function staff(array $owner, string $email, string $role): array
    {
        $this->postJson('/api/staff', ['name' => ucfirst($role).' '.$email, 'email' => $email, 'password' => '123456', 'role' => $role], $owner)->assertCreated();

        return $this->login($email, '123456');
    }

    private function line(array $h, int $qty = 1, int $index = 0): array
    {
        return ['food_item_id' => $this->getJson('/api/menu/items', $h)->json("$index.id"), 'quantity' => $qty];
    }

    public function test_second_waiter_adds_to_the_tables_open_order_instead_of_creating_another(): void
    {
        $owner = $this->login('atithi@demo.test');
        $cap = $this->staff($owner, 'cap@x.test', 'captain');
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        $first = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($cap, 3, 0)]], $cap)->assertCreated()->json();
        $this->assertArrayNotHasKey('merged', $first);

        $second = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter, 2, 1)], 'notes' => 'no onion'], $waiter)->assertCreated()->json();
        $this->assertTrue($second['merged']);
        $this->assertSame($first['id'], $second['id']);                 // same order, same number
        $this->assertSame($first['order_no'], $second['order_no']);
        $this->assertSame('no onion', $second['notes']);

        // Only ONE open order for the table, holding both people's dishes, each tagged with who added it
        $orders = collect($this->getJson('/api/orders?open=1', $owner)->json())->where('table_id', $table);
        $this->assertCount(1, $orders);
        $items = $orders->first()['items'];
        $this->assertCount(2, $items);
        $this->assertEqualsCanonicalizing(['Captain cap@x.test', 'Waiter w@x.test'], collect($items)->pluck('adder.name')->all());
    }

    public function test_staff_see_and_edit_a_colleagues_table_order_but_not_their_takeaways(): void
    {
        $owner = $this->login('atithi@demo.test');
        $cap = $this->staff($owner, 'cap@x.test', 'captain');
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $dine = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($cap)]], $cap)->assertCreated()->json('id');
        $take = $this->postJson('/api/orders', ['items' => [$this->line($cap)]], $cap)->assertCreated()->json('id');

        $seen = collect($this->getJson('/api/orders?open=1', $waiter)->json())->pluck('id')->all();
        $this->assertContains($dine, $seen);        // the table's order is shared
        $this->assertNotContains($take, $seen);     // a colleague's takeaway is not

        $this->putJson("/api/orders/$dine/items", ['items' => [$this->line($waiter, 4, 0), $this->line($waiter, 1, 1)]], $waiter)->assertOk();
        $this->putJson("/api/orders/$take/items", ['items' => [$this->line($waiter)]], $waiter)->assertForbidden();
    }

    public function test_a_billed_table_and_qr_orders_stay_separate(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        $a = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter)]], $waiter)->assertCreated()->json();
        $this->postJson("/api/orders/{$a['id']}/bill", [], $owner)->assertSuccessful();
        // the first order is already billed: a new order for that table starts a fresh order
        $b = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter)]], $waiter)->assertCreated()->json();
        $this->assertNotSame($a['id'], $b['id']);
        $this->assertArrayNotHasKey('merged', $b);

        // a customer's QR order is never merged into a staff order (it waits for approval)
        $token = Tenant::unscoped(fn () => HotelTable::with('qrToken')->find($table)->qrToken->token);
        $slug = Tenant::unscoped(fn () => \App\Models\Company::where('email', 'atithi@demo.test')->value('slug'));
        $dish = $this->getJson('/api/menu/items', $owner)->json('0.id');
        $qr = $this->postJson("/api/public/menu/$slug/table/$token/orders", ['items' => [['food_item_id' => $dish, 'quantity' => 1]]]);
        if ($qr->status() === 201) {
            $this->assertNotSame($b['id'], $qr->json('id'));
        }
    }
}

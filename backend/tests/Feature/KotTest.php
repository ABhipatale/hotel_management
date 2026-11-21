<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\Order;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Kitchen Order Tickets: optional per company, OFF by default, and the old flow is untouched while it is off. */
class KotTest extends TestCase
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

    private function switchKot(bool $on, bool $print = false): void
    {
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['kot_enabled' => $on, 'kot_print' => $print], $this->login('admin@hms.test', 'Admin@12345'))->assertOk();
    }

    private function staff(array $owner, string $email, string $role): array
    {
        $this->postJson('/api/staff', ['name' => ucfirst($role), 'email' => $email, 'password' => '123456', 'role' => $role], $owner)->assertCreated();

        return $this->login($email, '123456');
    }

    private function line(array $h, int $index, int $qty = 1): array
    {
        return ['food_item_id' => $this->getJson('/api/menu/items', $h)->json("$index.id"), 'quantity' => $qty];
    }

    public function test_kot_is_off_by_default_and_changes_nothing(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->assertFalse((bool) $this->getJson('/api/auth/me', $owner)->json('company.kot_enabled'));
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $order = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($owner, 0)]], $owner)->assertCreated()->json();
        $this->assertSame('accepted', $order['status']);
        $this->getJson('/api/kots', $owner)->assertForbidden();
        $this->assertSame(0, \App\Models\Kot::withoutGlobalScopes()->count());
        $this->postJson('/api/staff', ['name' => 'C', 'email' => 'c@x.test', 'password' => '123456', 'role' => 'chef'], $owner)->assertStatus(422); // no chef role while KOT is off
    }

    public function test_full_kot_flow_when_enabled(): void
    {
        $this->switchKot(true, true);
        $owner = $this->login('atithi@demo.test');
        $me = $this->getJson('/api/auth/me', $owner)->json('company');
        $this->assertTrue($me['kot_enabled']);
        $this->assertTrue($me['kot_print']);

        $chef = $this->staff($owner, 'chef@x.test', 'chef');
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $captain = $this->staff($owner, 'cap@x.test', 'captain');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        // waiter orders -> KOT 1 holds the dishes
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter, 0, 2), $this->line($waiter, 1)], 'notes' => 'less spicy'], $waiter)->assertCreated()->json();
        $kots = $this->getJson('/api/kots', $chef)->assertOk()->json();
        $this->assertCount(1, $kots);
        $this->assertSame(1, $kots[0]['number']);
        $this->assertSame('new', $kots[0]['status']);
        $this->assertCount(2, $kots[0]['items']);
        $this->assertSame('less spicy', $kots[0]['note']);
        $this->assertSame($o['order_no'], $kots[0]['order']['order_no']);

        // captain adds to the same table -> KOT 2 holds ONLY the new dish
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($captain, 2)]], $captain)->assertCreated();
        $kots = collect($this->getJson('/api/kots', $chef)->json());
        $this->assertCount(2, $kots);
        $this->assertCount(1, $kots->firstWhere('number', 2)['items']);

        // the chef cannot see orders / billing; a waiter cannot cook
        $this->getJson('/api/orders', $chef)->assertForbidden();
        $k1 = $kots->firstWhere('number', 1)['id'];
        $this->patchJson("/api/kots/$k1/status", ['status' => 'cooking'], $waiter)->assertForbidden();

        $this->getJson('/api/kots/ready', $waiter)->assertOk();
        $since = $this->getJson('/api/kots/ready', $waiter)->json('since');

        // kitchen: cooking -> ready -> order follows
        $this->patchJson("/api/kots/$k1/status", ['status' => 'cooking'], $chef)->assertOk();
        $this->assertSame('preparing', Order::withoutGlobalScopes()->find($o['id'])->status);
        $k2 = $kots->firstWhere('number', 2)['id'];
        $this->patchJson("/api/kots/$k1/status", ['status' => 'ready'], $chef)->assertOk();
        $this->assertNotSame('ready', Order::withoutGlobalScopes()->find($o['id'])->status); // KOT 2 is still waiting
        $this->patchJson("/api/kots/$k2/status", ['status' => 'ready'], $chef)->assertOk();
        $this->assertSame('ready', Order::withoutGlobalScopes()->find($o['id'])->status);

        // the waiter who owns the order hears about both tickets; the captain only about the dish he sent
        $alert = collect($this->getJson('/api/kots/ready?since='.urlencode($since), $waiter)->assertOk()->json('kots'))->pluck('id')->all();
        $this->assertEqualsCanonicalizing([$k1, $k2], $alert);
        $this->assertSame([$k2], collect($this->getJson('/api/kots/ready?since='.urlencode($since), $captain)->json('kots'))->pluck('id')->all());

        // serving: waiter may mark served
        $this->patchJson("/api/kots/$k1/status", ['status' => 'served'], $waiter)->assertOk();
        $this->patchJson("/api/kots/$k2/status", ['status' => 'served'], $waiter)->assertOk();
        $this->assertSame('served', Order::withoutGlobalScopes()->find($o['id'])->status);

        // the order card shows its tickets
        $this->assertCount(2, $this->getJson('/api/orders?open=1', $owner)->json('0.kots'));
    }

    public function test_serving_or_billing_an_order_removes_its_tickets_from_the_kitchen_board(): void
    {
        $this->switchKot(true, true);
        $owner = $this->login('atithi@demo.test');
        $chef = $this->staff($owner, 'chef2@x.test', 'chef');
        $tables = $this->getJson('/api/tables', $owner)->json();

        $a = $this->postJson('/api/orders', ['table_id' => $tables[0]['id'], 'items' => [$this->line($owner, 0)]], $owner)->assertCreated()->json();
        $b = $this->postJson('/api/orders', ['table_id' => $tables[1]['id'], 'items' => [$this->line($owner, 1)]], $owner)->assertCreated()->json();
        $this->assertCount(2, $this->getJson('/api/kots', $chef)->json());

        // serving order A clears its ticket
        $this->patchJson("/api/orders/{$a['id']}/status", ['status' => 'served'], $owner)->assertOk();
        $board = collect($this->getJson('/api/kots', $chef)->json());
        $this->assertCount(1, $board);
        $this->assertSame($b['order_no'], $board[0]['order']['order_no']);

        // billing order B clears its ticket too (it was still "new" in the kitchen)
        $this->postJson("/api/orders/{$b['id']}/bill", [], $owner)->assertSuccessful();
        $this->assertCount(0, $this->getJson('/api/kots', $chef)->json());
    }

    public function test_parcel_counters_take_takeaway_orders_and_the_customer_name_is_asked_at_checkout(): void
    {
        $this->switchKot(true, true);
        $owner = $this->login('atithi@demo.test');
        $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '9', 'capacity' => 1], $owner)->assertForbidden(); // off unless the platform admin enables it
        \App\Models\Company::query()->update(['parcel_enabled' => true]);
        $p1 = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertCreated()->json();
        $p2 = $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => 'Parcel 2', 'capacity' => 1], $owner)->assertCreated()->json();
        $this->assertSame('Parcel 1', $p1['number']);
        $this->assertSame('Parcel 2', $p2['number']);
        $this->assertSame('parcel', $p1['kind']);
        $this->postJson('/api/tables', ['kind' => 'parcel', 'number' => '1', 'capacity' => 1], $owner)->assertStatus(422); // no duplicate

        // two parcel orders are open at once, each is a takeaway, and the kitchen slip says which parcel it is
        $a = $this->postJson('/api/orders', ['table_id' => $p1['id'], 'type' => 'dine_in', 'items' => [$this->line($owner, 0)]], $owner)->assertCreated()->json();
        $b = $this->postJson('/api/orders', ['table_id' => $p2['id'], 'items' => [$this->line($owner, 1)]], $owner)->assertCreated()->json();
        $this->assertSame('takeaway', $a['type']);
        $this->assertSame('Parcel 1', $a['kot']['order']['table']['number']);
        $this->assertNotSame($a['id'], $b['id']);

        // checkout: the customer's name is saved on the order and comes back on the bill
        $bill = $this->postJson("/api/orders/{$a['id']}/bill", [], $owner)->assertCreated()->json();
        $paid = $this->postJson("/api/bills/{$bill['id']}/pay", ['customer_name' => 'Ramesh', 'payments' => [['method' => 'cash', 'amount' => $bill['grand_total']]]], $owner)->assertSuccessful();
        $this->assertSame('Ramesh', $paid->json('customer_name'));
        $this->assertSame('Parcel 1', $paid->json('table'));
    }

    public function test_an_owner_can_clear_the_bill_header(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->postJson('/api/company', ['bill_header' => 'Rahul patil'], $owner)->assertOk();
        $this->assertSame('Rahul patil', $this->getJson('/api/company', $owner)->json('bill_header'));
        $this->postJson('/api/company', ['bill_header' => ''], $owner)->assertOk(); // the screen now sends an empty value when the field was cleared
        $this->assertNull($this->getJson('/api/company', $owner)->json('bill_header'));
    }

    public function test_editing_an_order_sends_only_the_difference_and_cancels_reach_the_kitchen(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        $chef = $this->staff($owner, 'chef@x.test', 'chef');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $a = $this->line($owner, 0, 2);
        $b = $this->line($owner, 1, 1);
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$a, $b]], $owner)->assertCreated()->json();

        // 2 -> 3 of dish A (+1), dish B removed (-1), dish C added
        $c = $this->line($owner, 2, 1);
        $this->putJson("/api/orders/{$o['id']}/items", ['items' => [['food_item_id' => $a['food_item_id'], 'quantity' => 3], $c]], $owner)->assertOk();

        $kots = collect($this->getJson('/api/kots', $chef)->json());
        $this->assertCount(3, $kots); // original + "new" delta + "cancel"
        $new = $kots->firstWhere('number', 2);
        $this->assertSame('new', $new['type']);
        $this->assertEqualsCanonicalizing([1, 1], collect($new['items'])->pluck('quantity')->all()); // +1 of A, 1 of C
        $cancel = $kots->firstWhere('type', 'cancel');
        $this->assertSame([1], collect($cancel['items'])->pluck('quantity')->all());   // B

        // a cancel ticket is acknowledged, not cooked
        $this->patchJson("/api/kots/{$cancel['id']}/status", ['status' => 'cooking'], $chef)->assertStatus(422);
        $this->patchJson("/api/kots/{$cancel['id']}/status", ['status' => 'served'], $chef)->assertOk();

        // cancelling the whole order stops everything still in the kitchen
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'cancelled'], $owner)->assertOk();
        $this->assertTrue(collect($this->getJson('/api/kots', $chef)->json())->contains(fn ($k) => $k['type'] === 'cancel' && $k['status'] === 'new' && $k['id'] !== $cancel['id']));
    }

    public function test_approved_customer_order_goes_to_the_kitchen_and_switching_off_hides_it(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($owner, 0)]], $owner)->assertCreated()->json();
        // pretend it is a customer's QR order waiting for approval: no ticket yet
        \App\Models\Kot::withoutGlobalScopes()->delete();
        Order::withoutGlobalScopes()->whereKey($o['id'])->update(['status' => 'pending', 'source' => 'qr']);
        $this->assertCount(0, $this->getJson('/api/kots', $owner)->json());
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'accepted'], $owner)->assertOk();
        $this->assertCount(1, $this->getJson('/api/kots', $owner)->json());

        $this->switchKot(false);
        $this->getJson('/api/kots', $owner)->assertForbidden();
        $this->assertFalse((bool) Company::where('email', 'atithi@demo.test')->value('kot_print'));
        // the order itself still works as before
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'served'], $owner)->assertOk();
    }

    public function test_one_chef_can_cook_for_several_counters_but_not_all(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['multi_counter' => true, 'kot_enabled' => true], $admin)->assertOk();
        foreach (['Counter 2', 'Counter 3'] as $n) {
            $this->postJson("/api/admin/companies/$id/counters", ['name' => $n], $admin)->assertCreated();
        }
        $owner = $this->login('atithi@demo.test');
        [$c1, $c2, $c3] = collect($this->getJson('/api/auth/me', $owner)->json('counters'))->pluck('id')->all();

        // a chef needs at least one counter; here two of the three
        $this->postJson('/api/staff', ['name' => 'Chef', 'email' => 'chef@x.test', 'password' => '123456', 'role' => 'chef'], $owner)->assertStatus(422);
        $this->postJson('/api/staff', ['name' => 'Chef', 'email' => 'chef@x.test', 'password' => '123456', 'role' => 'chef', 'branch_ids' => [$c1, $c2]], $owner)->assertCreated();
        $chef = $this->login('chef@x.test', '123456');
        $this->assertEqualsCanonicalizing([$c1, $c2], collect($this->getJson('/api/auth/me', $chef)->json('counters'))->pluck('id')->all());
        $this->assertEqualsCanonicalizing([$c1, $c2], collect($this->getJson('/api/staff', $owner)->json())->firstWhere('email', 'chef@x.test')['branch_ids']);

        // one order on each counter (the owner picks the counter with the X-Counter-Id header)
        $placed = [];
        foreach ([$c1, $c2, $c3] as $c) {
            $h = $owner + ['X-Counter-Id' => (string) $c];
            $table = $this->getJson('/api/tables', $h)->json('0.id');
            $dish = $this->getJson('/api/menu/items', $h)->json('0.id');
            $placed[$c] = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $h)->assertCreated()->json('id');
        }
        $kots = collect($this->getJson('/api/kots', $chef)->assertOk()->json());
        $this->assertEqualsCanonicalizing([$c1, $c2], $kots->pluck('branch_id')->unique()->all()); // counter 3 stays hidden
        $this->assertCount(2, $kots);

        // the chef can cook a ticket of either of his counters, but not touch counter 3's
        $this->patchJson('/api/kots/'.$kots->firstWhere('branch_id', $c2)['id'].'/status', ['status' => 'cooking'], $chef)->assertOk();
        $other = \App\Models\Kot::withoutGlobalScopes()->where('branch_id', $c3)->value('id');
        $this->patchJson("/api/kots/$other/status", ['status' => 'cooking'], $chef)->assertNotFound();

        // changing the chef's counters
        $cid = collect($this->getJson('/api/staff', $owner)->json())->firstWhere('email', 'chef@x.test')['id'];
        $this->putJson("/api/staff/$cid", ['branch_ids' => [$c3]], $owner)->assertOk();
        $chef = $this->login('chef@x.test', '123456');
        $this->assertSame([$c3], collect($this->getJson('/api/kots', $chef)->json())->pluck('branch_id')->unique()->values()->all());
    }

    public function test_admin_sets_the_slip_print_mode_only_while_kot_printing_is_on(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $owner = $this->login('atithi@demo.test');
        $this->assertNull($this->getJson('/api/auth/me', $owner)->json('company.kot_print_mode')); // default: each device decides

        $this->putJson("/api/admin/companies/$id", ['kot_enabled' => true, 'kot_print' => true, 'kot_print_mode' => 'ask'], $admin)->assertOk();
        $this->assertSame('ask', $this->getJson('/api/auth/me', $owner)->json('company.kot_print_mode'));
        $this->putJson("/api/admin/companies/$id", ['kot_print_mode' => 'nonsense'], $admin)->assertStatus(422);

        $this->putJson("/api/admin/companies/$id", ['kot_print' => false], $admin)->assertOk(); // printing off => mode cleared
        $this->assertNull($this->getJson('/api/auth/me', $owner)->json('company.kot_print_mode'));
    }

    public function test_print_only_mode_has_slips_but_no_kitchen_screen(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $owner = $this->login('atithi@demo.test');

        // KOT on, kitchen screen OFF: printing is forced on, the screen is gone
        $this->putJson("/api/admin/companies/$id", ['kot_enabled' => true, 'kot_screen' => false, 'kot_print' => false, 'kot_print_mode' => 'ask'], $admin)->assertOk();
        $co = $this->getJson('/api/auth/me', $owner)->json('company');
        $this->assertFalse((bool) $co['kot_screen']);
        $this->assertTrue((bool) $co['kot_print']);
        $this->assertSame('ask', $co['kot_print_mode']);

        $this->getJson('/api/kots', $owner)->assertForbidden();        // no kitchen board
        $this->getJson('/api/kots/ready', $owner)->assertForbidden();  // no ready alerts
        $this->postJson('/api/staff', ['name' => 'C', 'email' => 'c@x.test', 'password' => '123456', 'role' => 'chef'], $owner)->assertStatus(422); // no chef login

        // ...but placing an order still creates the ticket (to print) and the slip can be marked printed
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $order = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($owner, 0)]], $owner)->assertCreated()->json();
        $this->assertNotEmpty($order['kot']);
        $tbl = $this->getJson('/api/tables', $owner)->json('0.number');
        $this->assertSame($tbl, $order['kot']['order']['table']['number']); // the slip prints "TABLE n", not "takeaway"
        $this->postJson('/api/kots/'.$order['kot']['id'].'/printed', [], $owner)->assertOk();

        // switching the screen back on restores the kitchen
        $this->putJson("/api/admin/companies/$id", ['kot_screen' => true], $admin)->assertOk();
        $this->getJson('/api/kots', $owner)->assertOk();
    }

    public function test_slip_lines_carry_the_dish_marathi_name_for_marathi_slips(): void
    {
        $this->switchKot(true, true);
        $owner = $this->login('atithi@demo.test');
        $dishes = $this->getJson('/api/menu/items', $owner)->json();
        $companyId = Company::where('email', 'atithi@demo.test')->value('id');
        \App\Models\FoodItem::withoutGlobalScopes()->where('company_id', $companyId)->where('id', $dishes[0]['id'])->update(['name_mr' => 'पनीर बटर मसाला']);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        // the slip returned with the new order (printed from the order screen)
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($owner, 0, 2), $this->line($owner, 1)]], $owner)->assertCreated()->json();
        $lines = collect($o['kot']['items'])->keyBy('name');
        $this->assertSame('पनीर बटर मसाला', $lines[$dishes[0]['name']]['name_mr']);
        $this->assertSame($dishes[0]['name'], $lines[$dishes[0]['name']]['name']); // the English name is unchanged
        $this->assertArrayHasKey('name_mr', $lines[$dishes[1]['name']]);
        $this->assertNull($lines[$dishes[1]['name']]['name_mr']); // no Marathi name: null, the slip prints the English one

        // the kitchen board (printed from the kitchen screen)
        $board = collect($this->getJson('/api/kots', $owner)->assertOk()->json())->firstWhere('id', $o['kot']['id']);
        $this->assertSame('पनीर बटर मसाला', collect($board['items'])->firstWhere('name', $dishes[0]['name'])['name_mr']);
    }
}

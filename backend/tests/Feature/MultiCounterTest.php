<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Multi-counter companies: counter logins see only their counter, the owner sees every counter and the total. */
class MultiCounterTest extends TestCase
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

    /** Atithi becomes a 2-counter company; returns [ownerHeaders, counter1Id, counter2Id]. */
    private function setup2(): array
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['multi_counter' => true], $admin)->assertOk()->assertJsonPath('multi_counter', true);
        $this->postJson("/api/admin/companies/$id/counters", ['name' => 'Counter 2'], $admin)->assertCreated();
        $owner = $this->login('atithi@demo.test');
        $c = $this->getJson('/api/auth/me', $owner)->json('counters');
        $this->assertCount(2, $c);

        return [$owner, $c[0]['id'], $c[1]['id']];
    }

    private function counterLogin(array $owner, int $branch, string $email): array
    {
        $this->postJson('/api/staff', ['name' => $email, 'email' => $email, 'password' => '123456', 'role' => 'counter', 'branch_id' => $branch], $owner)->assertCreated();

        return $this->login($email, '123456');
    }

    public function test_single_counter_company_is_unchanged_and_cannot_use_counter_features(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->assertNull($this->getJson('/api/auth/me', $owner)->json('counters'));
        $this->getJson('/api/counters/overview', $owner)->assertNotFound();
        $this->postJson('/api/staff', ['name' => 'C', 'email' => 'c@x.test', 'password' => '123456', 'role' => 'counter'], $owner)->assertStatus(422);
    }

    public function test_counters_have_their_own_tables_and_numbers_and_are_isolated(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $a = $this->counterLogin($owner, $c1, 'one@x.test');
        $b = $this->counterLogin($owner, $c2, 'two@x.test');

        // Both counters can have "T1": table numbers are per counter
        $t1 = $this->postJson('/api/tables', ['number' => 'T1', 'capacity' => 4], $a)->assertCreated()->json('id');
        $t2 = $this->postJson('/api/tables', ['number' => 'T1', 'capacity' => 2], $b)->assertCreated()->json('id');
        $this->postJson('/api/tables', ['number' => 'T1', 'capacity' => 2], $b)->assertStatus(422);

        $ids = fn ($h) => collect($this->getJson('/api/tables', $h)->json())->pluck('id')->all();
        $this->assertContains($t1, $ids($a));
        $this->assertNotContains($t2, $ids($a));
        $this->assertContains($t2, $ids($b));
        $this->assertNotContains($t1, $ids($b));

        // Counter 2 cannot touch counter 1's table (it does not exist for them)
        $this->putJson("/api/tables/$t1", ['capacity' => 9], $b)->assertNotFound();

        // An order from counter 1 is invisible to counter 2, and a counter can't order on another counter's table
        $dish = $this->getJson('/api/menu/items', $a)->assertOk()->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $t1, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $a)->assertCreated()->json();
        $this->getJson("/api/orders/{$o['id']}", $b)->assertNotFound();
        $this->postJson('/api/orders', ['table_id' => $t1, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $b)->assertStatus(404);
        $this->assertCount(0, $this->getJson('/api/orders', $b)->json());

        // order numbers stay unique across counters
        $o2 = $this->postJson('/api/orders', ['table_id' => $t2, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $b)->assertCreated()->json();
        $this->assertNotEquals($o['order_no'], $o2['order_no']);
    }

    public function test_counter_user_cannot_pick_another_counter_with_the_header(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $a = $this->counterLogin($owner, $c1, 'one@x.test');
        $b = $this->counterLogin($owner, $c2, 'two@x.test');
        $this->postJson('/api/tables', ['number' => 'B1', 'capacity' => 2], $b)->assertCreated();
        $seen = collect($this->getJson('/api/tables', $a + ['X-Counter-Id' => $c2])->json())->pluck('number');
        $this->assertNotContains('B1', $seen); // the header is ignored for counter users
        $this->getJson('/api/counters/overview', $a)->assertForbidden();
    }

    public function test_owner_sees_each_counter_and_the_total_with_profit_and_loss(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $a = $this->counterLogin($owner, $c1, 'one@x.test');
        $b = $this->counterLogin($owner, $c2, 'two@x.test');
        $dish = $this->getJson('/api/menu/items', $a)->json('0');

        foreach ([[$a, 1], [$b, 3]] as [$h, $qty]) {
            $o = $this->postJson('/api/orders', ['items' => [['food_item_id' => $dish['id'], 'quantity' => $qty]], 'generate_bill' => true], $h)->assertCreated()->json();
            $this->postJson("/api/bills/{$o['bill']['id']}/pay", ['payments' => [['method' => 'cash', 'amount' => $o['bill']['grand_total']]]], $h)->assertOk();
        }
        $this->postJson('/api/expenses', ['category' => 'Gas', 'amount' => 5, 'expense_date' => now()->toDateString()], $b)->assertCreated();

        $ov = $this->getJson('/api/counters/overview', $owner)->assertOk()->json();
        $by = collect($ov['counters'])->keyBy('id');
        $this->assertGreaterThan(0, $by[$c1]['sales']);
        $this->assertEqualsWithDelta($by[$c1]['sales'] * 3, $by[$c2]['sales'], 0.01);
        $this->assertEquals(5.0, $by[$c2]['expenses']);
        $this->assertEquals(0.0, $by[$c1]['expenses']);
        $this->assertEqualsWithDelta($by[$c1]['sales'] + $by[$c2]['sales'], $ov['total']['sales'], 0.01);
        $this->assertEqualsWithDelta($by[$c1]['profit'] + $by[$c2]['profit'], $ov['total']['profit'], 0.01);

        // Each counter's own dashboard only covers that counter; the owner can filter by counter or see all
        $this->assertEqualsWithDelta($by[$c1]['sales'], $this->getJson('/api/dashboard', $a)->json('today_sales'), 0.01);
        $this->assertEqualsWithDelta($by[$c2]['sales'], $this->getJson('/api/dashboard', $b)->json('today_sales'), 0.01);
        $this->assertEqualsWithDelta($ov['total']['sales'], $this->getJson('/api/dashboard', $owner)->json('today_sales'), 0.01);
        $this->assertEqualsWithDelta($by[$c2]['sales'], $this->getJson('/api/dashboard', $owner + ['X-Counter-Id' => $c2])->json('today_sales'), 0.01);
    }

    public function test_cannot_switch_back_to_single_counter_while_extra_counters_exist(): void
    {
        $this->setup2();
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['multi_counter' => false], $admin)->assertStatus(422);
        $this->assertSame('Counter 1', Tenant::unscoped(fn () => Branch::where('company_id', $id)->where('is_default', true)->value('name')));
    }
}

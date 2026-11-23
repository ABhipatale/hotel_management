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
        $this->postJson('/api/expenses', ['category' => 'Gas', 'amount' => 5, 'expense_date' => \App\Support\BizTime::today()], $b)->assertCreated();

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

    public function test_waiter_with_multiple_counters_can_switch_with_header_and_defaults_to_main_counter(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $c3 = $this->postJson("/api/admin/companies/$id/counters", ['name' => 'Counter 3'], $admin)->assertCreated()->json('id');

        // Owner creates tables on counter 1, counter 2 and counter 3
        $t1 = $this->postJson('/api/tables', ['number' => 'T1', 'capacity' => 4], $owner + ['X-Counter-Id' => (string) $c1])->assertCreated()->json('id');
        $t2 = $this->postJson('/api/tables', ['number' => 'T2', 'capacity' => 4], $owner + ['X-Counter-Id' => (string) $c2])->assertCreated()->json('id');
        $t3 = $this->postJson('/api/tables', ['number' => 'T3', 'capacity' => 4], $owner + ['X-Counter-Id' => (string) $c3])->assertCreated()->json('id');

        // Owner creates a waiter with counters 1 and 2 (counter 1 is main)
        $w = $this->postJson('/api/staff', [
            'name' => 'Multi Waiter',
            'email' => 'mwaiter@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1, $c2],
        ], $owner)->assertCreated()->json();

        $this->assertSame($c1, $w['branch_id']);
        $this->assertSame([$c1, $c2], $w['branch_ids']);

        $waiter = $this->login('mwaiter@x.test', '123456');

        // /api/auth/me returns their counters and their main counter
        $me = $this->getJson('/api/auth/me', $waiter)->assertOk()->json();
        $this->assertCount(2, $me['counters']);
        $this->assertSame($c1, $me['counter']['id']);

        // Without header: lands on counter 1 (main) -> sees T1, does not see T2 or T3
        $seenNoHeader = collect($this->getJson('/api/tables', $waiter)->json())->pluck('id')->all();
        $this->assertContains($t1, $seenNoHeader);
        $this->assertNotContains($t2, $seenNoHeader);
        $this->assertNotContains($t3, $seenNoHeader);

        // With X-Counter-Id = counter 2: lands on counter 2 -> sees T2, does not see T1 or T3
        $seenC2 = collect($this->getJson('/api/tables', $waiter + ['X-Counter-Id' => (string) $c2])->json())->pluck('id')->all();
        $this->assertContains($t2, $seenC2);
        $this->assertNotContains($t1, $seenC2);
        $this->assertNotContains($t3, $seenC2);

        // Order placement: waiter can order on T2 when working in counter 2
        $dish = $this->getJson('/api/menu/items', $waiter)->json('0.id');
        $this->postJson('/api/orders', ['table_id' => $t2, 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $waiter + ['X-Counter-Id' => (string) $c2])->assertCreated();

        // Header for counter 3 (not theirs) is ignored -> falls back to main counter 1
        $seenC3 = collect($this->getJson('/api/tables', $waiter + ['X-Counter-Id' => (string) $c3])->json())->pluck('id')->all();
        $this->assertContains($t1, $seenC3);
        $this->assertNotContains($t2, $seenC3);
        $this->assertNotContains($t3, $seenC3);
    }

    public function test_header_for_counter_from_another_company_falls_back_to_main_counter(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $t1 = $this->postJson('/api/tables', ['number' => 'W11', 'capacity' => 4], $owner + ['X-Counter-Id' => (string) $c1])->assertCreated()->json('id');
        $t2 = $this->postJson('/api/tables', ['number' => 'W22', 'capacity' => 4], $owner + ['X-Counter-Id' => (string) $c2])->assertCreated()->json('id');

        $this->postJson('/api/staff', [
            'name' => 'W2',
            'email' => 'w2@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1, $c2],
        ], $owner)->assertCreated();

        $waiter = $this->login('w2@x.test', '123456');

        // Friends hotel branch id
        $friendsBranch = Tenant::unscoped(fn () => Branch::where('company_id', Company::where('email', 'friends@demo.test')->value('id'))->value('id'));
        $this->assertNotNull($friendsBranch);

        // Header with another company's branch id -> ignored, lands on main counter c1
        $seen = collect($this->getJson('/api/tables', $waiter + ['X-Counter-Id' => (string) $friendsBranch])->json())->pluck('id')->all();
        $this->assertContains($t1, $seen);
        $this->assertNotContains($t2, $seen);
    }

    public function test_disabled_counter_cannot_be_used(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $t1 = $this->postJson('/api/tables', ['number' => 'Active1', 'capacity' => 2], $owner + ['X-Counter-Id' => (string) $c1])->assertCreated()->json('id');
        $t2 = $this->postJson('/api/tables', ['number' => 'Active2', 'capacity' => 2], $owner + ['X-Counter-Id' => (string) $c2])->assertCreated()->json('id');

        $this->postJson('/api/staff', [
            'name' => 'W3',
            'email' => 'w3@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1, $c2],
        ], $owner)->assertCreated();

        $waiter = $this->login('w3@x.test', '123456');

        // Disable counter 2
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id/counters/$c2", ['is_active' => false], $admin)->assertOk();

        // Waiter attempts to pick disabled counter 2 -> ignored, lands on active main counter 1
        $seen = collect($this->getJson('/api/tables', $waiter + ['X-Counter-Id' => (string) $c2])->json())->pluck('id')->all();
        $this->assertContains($t1, $seen);
        $this->assertNotContains($t2, $seen);

        // Staff member who has ONLY a disabled counter cannot use the app
        $this->postJson('/api/staff', [
            'name' => 'Disabled Staff',
            'email' => 'disabled_staff@x.test',
            'password' => '123456',
            'role' => 'counter',
            'branch_ids' => [$c2],
        ], $owner)->assertCreated();

        $disabledUser = $this->login('disabled_staff@x.test', '123456');
        $this->getJson('/api/tables', $disabledUser)->assertStatus(403);
    }

    public function test_old_style_branch_id_only_staff_create_and_update_still_works(): void
    {
        [$owner, $c1, $c2] = $this->setup2();

        // Old app sends only branch_id (no branch_ids)
        $created = $this->postJson('/api/staff', [
            'name' => 'Old Staff',
            'email' => 'old_staff@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_id' => $c1,
        ], $owner)->assertCreated()->json();

        $this->assertSame($c1, $created['branch_id']);
        $this->assertSame([$c1], $created['branch_ids']);

        // Old app updates using only branch_id
        $updated = $this->putJson("/api/staff/{$created['id']}", [
            'branch_id' => $c2,
        ], $owner)->assertOk()->json();

        $this->assertSame($c2, $updated['branch_id']);
        $this->assertSame([$c2], $updated['branch_ids']);
    }

    public function test_tokens_revoked_when_counters_change(): void
    {
        [$owner, $c1, $c2] = $this->setup2();

        $s = $this->postJson('/api/staff', [
            'name' => 'Revoke Staff',
            'email' => 'revoke@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1],
        ], $owner)->assertCreated()->json();

        $staffLogin = $this->login('revoke@x.test', '123456');
        $this->getJson('/api/tables', $staffLogin)->assertOk();

        // Adding counter 2 changes the counter set -> tokens revoked
        $this->putJson("/api/staff/{$s['id']}", [
            'branch_ids' => [$c1, $c2],
        ], $owner)->assertOk();

        $this->getJson('/api/tables', $staffLogin)->assertUnauthorized();

        // Log in again
        $staffLogin2 = $this->login('revoke@x.test', '123456');
        $this->getJson('/api/tables', $staffLogin2)->assertOk();

        // Updating without changing counters keeps token valid
        $this->putJson("/api/staff/{$s['id']}", [
            'name' => 'Revoke Staff Renamed',
            'branch_ids' => [$c1, $c2],
        ], $owner)->assertOk();

        $this->getJson('/api/tables', $staffLogin2)->assertOk();

        // Changing counter set again -> tokens revoked
        $this->putJson("/api/staff/{$s['id']}", [
            'branch_ids' => [$c2],
        ], $owner)->assertOk();

        $this->getJson('/api/tables', $staffLogin2)->assertUnauthorized();
    }

    public function test_branch_ids_from_another_company_are_refused(): void
    {
        [$owner, $c1] = $this->setup2();
        $friendsBranch = Tenant::unscoped(fn () => Branch::where('company_id', Company::where('email', 'friends@demo.test')->value('id'))->value('id'));

        // Attempt store with foreign branch id
        $this->postJson('/api/staff', [
            'name' => 'Attacker',
            'email' => 'attacker@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$friendsBranch],
        ], $owner)->assertStatus(422);

        // Attempt store with mix of own and foreign
        $this->postJson('/api/staff', [
            'name' => 'Attacker 2',
            'email' => 'attacker2@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1, $friendsBranch],
        ], $owner)->assertStatus(422);

        $legit = $this->postJson('/api/staff', [
            'name' => 'Legit',
            'email' => 'legit@x.test',
            'password' => '123456',
            'role' => 'waiter',
            'branch_ids' => [$c1],
        ], $owner)->assertCreated()->json('id');

        // Attempt update with foreign branch id
        $this->putJson("/api/staff/$legit", [
            'branch_ids' => [$friendsBranch],
        ], $owner)->assertStatus(422);
    }

    /**
     * Review 2026-11-24, problem 1: `branch_user` has no `id` column. MySQL refuses `ORDER BY id`; SQLite silently reads an unknown
     * quoted name as text, so only a check of the query itself catches it here.
     */
    public function test_counter_list_query_only_uses_real_columns(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $s = $this->postJson('/api/staff', ['name' => 'Q', 'email' => 'q@x.test', 'password' => '123456', 'role' => 'waiter', 'branch_ids' => [$c1, $c2]], $owner)->assertCreated()->json();

        $columns = \Illuminate\Support\Facades\Schema::getColumnListing('branch_user');
        $sql = [];
        \Illuminate\Support\Facades\DB::listen(function ($q) use (&$sql) {
            if (str_contains($q->sql, 'branch_user')) {
                $sql[] = $q->sql;
            }
        });
        Tenant::unscoped(fn () => \App\Models\User::find($s['id'])->counterIds());

        $this->assertNotEmpty($sql);
        foreach ($sql as $q) {
            preg_match_all('/order by\s+(.+?)(?:\s+limit|$)/i', $q, $m);
            foreach ($m[1] as $part) {
                foreach (explode(',', $part) as $col) {
                    $name = trim(preg_replace('/\s+(asc|desc)$/i', '', trim($col)), '"`[] ');
                    $this->assertContains($name, $columns, "branch_user has no column \"$name\": $q");
                }
            }
        }
    }

    /** Problem 2: the main counter (users.branch_id) is listed first, whatever order the link rows have, so editing keeps it main. */
    public function test_main_counter_is_listed_first_and_an_edit_keeps_it(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $s = $this->postJson('/api/staff', ['name' => 'M', 'email' => 'main@x.test', 'password' => '123456', 'role' => 'waiter', 'branch_ids' => [$c1, $c2]], $owner)->assertCreated()->json();
        // main = counter 2, while the link rows still read counter 1 first (as MySQL returns them, by primary key)
        Tenant::unscoped(fn () => \App\Models\User::whereKey($s['id'])->update(['branch_id' => $c2]));

        $row = collect($this->getJson('/api/staff', $owner)->json())->firstWhere('id', $s['id']);
        $this->assertSame([$c2, $c1], $row['branch_ids']);

        // the Staff screen sends the list back as it got it (name change only): main stays counter 2
        $after = $this->putJson("/api/staff/{$s['id']}", ['name' => 'M2', 'branch_ids' => $row['branch_ids']], $owner)->assertOk()->json();
        $this->assertSame($c2, $after['branch_id']);
        $this->assertSame([$c2, $c1], $after['branch_ids']);
        $this->assertSame($c2, $this->getJson('/api/auth/me', $this->login('main@x.test', '123456'))->json('counter.id'));
    }

    /** Problem 3: an older installed app edits a staff member with only branch_id (their main counter): the other counters stay, the login stays. */
    public function test_old_app_edit_with_the_main_counter_keeps_the_other_counters_and_the_login(): void
    {
        [$owner, $c1, $c2] = $this->setup2();
        $s = $this->postJson('/api/staff', ['name' => 'O', 'email' => 'oldapp@x.test', 'password' => '123456', 'role' => 'waiter', 'branch_ids' => [$c1, $c2]], $owner)->assertCreated()->json();
        $waiter = $this->login('oldapp@x.test', '123456');

        $after = $this->putJson("/api/staff/{$s['id']}", ['name' => 'O renamed', 'branch_id' => $c1, 'role' => 'waiter'], $owner)->assertOk()->json();
        $this->assertSame([$c1, $c2], $after['branch_ids']);
        $this->getJson('/api/tables', $waiter)->assertOk(); // not signed out

        // choosing ANOTHER counter in the old app still moves them to just that one (the old meaning), and signs them in fresh
        $moved = $this->putJson("/api/staff/{$s['id']}", ['branch_id' => $c2], $owner)->assertOk()->json();
        $this->assertSame([$c2], $moved['branch_ids']);
        $this->getJson('/api/tables', $waiter)->assertUnauthorized();
    }

    /** Problem 4: staff created before multi-counter was switched on have no counter: they still see the default counter, as before. */
    public function test_staff_without_a_counter_still_get_the_default_counter(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->postJson('/api/staff', ['name' => 'Early', 'email' => 'early@x.test', 'password' => '123456', 'role' => 'waiter'], $owner)->assertCreated();
        [, $c1] = $this->setup2(); // multi-counter switched on afterwards

        $me = $this->getJson('/api/auth/me', $this->login('early@x.test', '123456'))->assertOk();
        $this->assertSame($c1, $me->json('counter.id'));
        $this->assertSame([$c1], collect($me->json('counters'))->pluck('id')->all());
    }
}

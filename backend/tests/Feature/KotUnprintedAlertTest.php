<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\Kot;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * "KOT not printed" alerts (company switch kot_unprinted_alert, platform admin only, off by default): kitchen slips a waiter's
 * phone did not print show up for the owner, counter manager and captains (GET /kots/unprinted), who print them and mark them
 * printed. The banner and the Print button are in the app (Layout / OrderAlertBanner / Orders).
 */
class KotUnprintedAlertTest extends TestCase
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

    private function companyId(): int
    {
        return Tenant::unscoped(fn () => Company::where('email', 'atithi@demo.test')->value('id'));
    }

    private function admin(array $data): void
    {
        $this->putJson('/api/admin/companies/'.$this->companyId(), $data, $this->login('admin@hms.test', 'Admin@12345'))->assertOk();
    }

    private function staff(array $owner, string $email, string $role, array $extra = []): array
    {
        $this->postJson('/api/staff', ['name' => ucfirst($role).' '.$email, 'email' => $email, 'password' => '123456', 'role' => $role] + $extra, $owner)->assertCreated();

        return $this->login($email, '123456');
    }

    private function line(array $h, int $index, int $qty = 1): array
    {
        return ['food_item_id' => $this->getJson('/api/menu/items', $h)->json("$index.id"), 'quantity' => $qty];
    }

    private function unprinted(array $h): \Illuminate\Support\Collection
    {
        return collect($this->getJson('/api/kots/unprinted', $h)->assertOk()->json('kots'));
    }

    public function test_it_is_off_by_default_and_only_the_platform_admin_switches_it(): void
    {
        $this->admin(['kot_enabled' => true, 'kot_print' => true]);
        $owner = $this->login('atithi@demo.test');
        $this->getJson('/api/auth/me', $owner)->assertOk()->assertJsonPath('company.kot_unprinted_alert', false);

        // a waiter's order that nobody printed: with the switch off nobody is told (the old behaviour)
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter, 0)]], $waiter)->assertCreated();
        $this->assertCount(0, $this->unprinted($owner));

        // the owner cannot switch it on from Settings
        $this->postJson('/api/company', ['kot_unprinted_alert' => true], $owner)->assertOk();
        $this->assertFalse((bool) Tenant::unscoped(fn () => Company::find($this->companyId())->kot_unprinted_alert));

        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['kot_unprinted_alert' => true], $admin)->assertOk()->assertJsonPath('kot_unprinted_alert', true);
        $this->getJson('/api/auth/me', $owner)->assertOk()->assertJsonPath('company.kot_unprinted_alert', true);
        $this->assertCount(1, $this->unprinted($owner));
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['city' => 'Pune'], $admin)->assertOk()->assertJsonPath('kot_unprinted_alert', true);
        $this->putJson('/api/admin/companies/'.$this->companyId(), ['kot_unprinted_alert' => 'yes please'], $admin)->assertStatus(422);

        // a new company gets it only when asked
        $base = ['owner_name' => 'Owner', 'password' => 'Secret@123', 'city' => 'Pune', 'kot_enabled' => true, 'kot_print' => true];
        $off = $this->postJson('/api/admin/companies', $base + ['company_name' => 'Plain Hotel', 'email' => 'plain@x.test', 'phone' => '9000000001'], $admin)->assertCreated()->json();
        $on = $this->postJson('/api/admin/companies', $base + ['company_name' => 'Alert Hotel', 'email' => 'alert@x.test', 'phone' => '9000000002', 'kot_unprinted_alert' => true], $admin)->assertCreated()->json();
        $this->assertFalse((bool) Tenant::unscoped(fn () => Company::find($off['id'])->kot_unprinted_alert));
        $this->assertTrue((bool) Tenant::unscoped(fn () => Company::find($on['id'])->kot_unprinted_alert));
    }

    public function test_it_does_nothing_without_printed_slips_or_without_kot(): void
    {
        $owner = $this->login('atithi@demo.test');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        // KOT off: the list is empty (no error, so an app with an old copy of the company settings stays quiet)
        $this->admin(['kot_unprinted_alert' => true]);
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($owner, 0)]], $owner)->assertCreated();
        $captain = $this->staff($owner, 'cap@x.test', 'captain');
        $this->assertCount(0, $this->unprinted($captain));
        $this->assertArrayNotHasKey('kots', $this->getJson('/api/orders', $owner)->json('0')); // order cards as before

        // kitchen screen only (no printed slips): nothing is "not printed"
        $this->admin(['kot_enabled' => true, 'kot_print' => false]);
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $t2 = $this->getJson('/api/tables', $owner)->json('1.id');
        $this->postJson('/api/orders', ['table_id' => $t2, 'items' => [$this->line($waiter, 0)]], $waiter)->assertCreated();
        $this->assertCount(0, $this->unprinted($owner));
    }

    public function test_a_waiters_unprinted_kot_reaches_the_owner_and_captains_until_someone_prints_it(): void
    {
        $this->admin(['kot_enabled' => true, 'kot_print' => true, 'kot_unprinted_alert' => true]);
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->staff($owner, 'w@x.test', 'waiter');
        $captain = $this->staff($owner, 'cap@x.test', 'captain');
        $chef = $this->staff($owner, 'chef@x.test', 'chef');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        // the waiter's phone does not print: the owner and the captain get the full ticket, ready to print on their device
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($waiter, 0, 2), $this->line($waiter, 1)], 'notes' => 'less spicy'], $waiter)->assertCreated()->json();
        $list = $this->unprinted($owner);
        $this->assertCount(1, $list);
        $k1 = $list[0];
        $this->assertSame('new', $k1['type']);
        $this->assertSame(1, $k1['number']);
        $this->assertSame('waiter', $k1['sender']['role']);
        $this->assertSame($o['order_no'], $k1['order']['order_no']);
        $this->assertNotNull($k1['order']['table']['number']);
        $this->assertEqualsCanonicalizing([2, 1], collect($k1['items'])->pluck('quantity')->all());
        $this->assertArrayHasKey('name_mr', $k1['items'][0]); // a Marathi slip can be printed from it
        $this->assertIsInt($k1['age']);
        $this->assertGreaterThanOrEqual(0, $k1['age']);
        $this->assertSame([$k1['id']], $this->unprinted($captain)->pluck('id')->all());
        $this->assertCount(0, $this->unprinted($waiter)); // nobody is reminded of their own slip

        // more dishes for the same table make a second ticket, also not printed
        $this->postJson("/api/orders/{$o['id']}/items", ['items' => [$this->line($waiter, 2)]], $waiter)->assertOk();
        $this->assertSame([1, 2], $this->unprinted($owner)->pluck('number')->all());

        // the captain prints the first one: it is gone for everyone, and the order card shows which tickets were printed
        $this->postJson("/api/kots/{$k1['id']}/printed", [], $captain)->assertOk();
        $this->assertSame([2], $this->unprinted($owner)->pluck('number')->all());
        $this->assertCount(0, $this->getJson("/api/kots/unprinted?id={$k1['id']}", $owner)->assertOk()->json('kots')); // checked right before printing: not twice
        $cards = collect($this->getJson('/api/orders', $owner)->json())->firstWhere('id', $o['id'])['kots'];
        $this->assertNotNull(collect($cards)->firstWhere('number', 1)['printed_at']);
        $this->assertNull(collect($cards)->firstWhere('number', 2)['printed_at']);

        // once the kitchen has started a ticket, printing it is no longer asked for
        $k2 = $this->unprinted($owner)->first();
        $this->patchJson("/api/kots/{$k2['id']}/status", ['status' => 'cooking'], $chef)->assertOk();
        $this->assertCount(0, $this->unprinted($owner));

        // the owner's own order (owner chose not to print) is shown to the captain, not to the owner
        $t2 = $this->getJson('/api/tables', $owner)->json('1.id');
        $this->postJson('/api/orders', ['table_id' => $t2, 'items' => [$this->line($owner, 0)]], $owner)->assertCreated();
        $this->assertCount(0, $this->unprinted($owner));
        $this->assertCount(1, $this->unprinted($captain));
        // ...but the owner can still print it from the order card (asked for by id, whoever sent it)
        $own = $this->unprinted($captain)->first();
        $this->assertSame([$own['id']], collect($this->getJson("/api/kots/unprinted?id={$own['id']}", $owner)->json('kots'))->pluck('id')->all());
        $this->getJson('/api/kots/unprinted?id=abc', $owner)->assertStatus(422);

        // a cancelled order: the "stop" ticket for the kitchen is a slip to print too
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'cancelled'], $owner)->assertOk();
        $this->assertTrue($this->unprinted($captain)->contains(fn ($k) => $k['type'] === 'cancel' && $k['order_id'] === $o['id']));

        // after 3 hours an unprinted ticket stops being announced
        $this->travel(4)->hours();
        $this->assertCount(0, $this->unprinted($captain));

        // a chef has no access to the list
        $this->getJson('/api/kots/unprinted', $chef)->assertForbidden();
    }

    public function test_each_counter_sees_only_its_own_unprinted_tickets(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = $this->companyId();
        $this->putJson("/api/admin/companies/$id", ['multi_counter' => true, 'kot_enabled' => true, 'kot_print' => true, 'kot_unprinted_alert' => true], $admin)->assertOk();
        $this->postJson("/api/admin/companies/$id/counters", ['name' => 'Counter 2'], $admin)->assertCreated();
        $owner = $this->login('atithi@demo.test');
        [$c1, $c2] = collect($this->getJson('/api/auth/me', $owner)->json('counters'))->pluck('id')->all();

        $w1 = $this->staff($owner, 'w1@x.test', 'waiter', ['branch_id' => $c1]);
        $m1 = $this->staff($owner, 'm1@x.test', 'counter', ['branch_id' => $c1]);
        $m2 = $this->staff($owner, 'm2@x.test', 'counter', ['branch_id' => $c2]);
        $table = $this->getJson('/api/tables', $w1)->json('0.id');
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [$this->line($w1, 0)]], $w1)->assertCreated();

        $this->assertCount(1, $this->unprinted($m1));
        $this->assertCount(0, $this->unprinted($m2));
        $this->assertCount(1, $this->unprinted($owner)); // all counters
        $this->assertCount(0, $this->unprinted($owner + ['X-Counter-Id' => $c2]));
        $kot = $this->unprinted($m1)->first();
        $this->assertCount(0, $this->getJson("/api/kots/unprinted?id={$kot['id']}", $m2)->json('kots')); // not even by id
        $this->postJson("/api/kots/{$kot['id']}/printed", [], $m2)->assertNotFound();
        $this->assertSame(1, Kot::withoutGlobalScopes()->whereNull('printed_at')->count());
    }
}

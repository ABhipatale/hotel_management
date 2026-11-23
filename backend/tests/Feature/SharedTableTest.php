<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** One table shared by two parties: T1 splits into T1A + T1B, each with its own order and bill; it closes when both are paid. */
class SharedTableTest extends TestCase
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

    private function h(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function enable(bool $on = true): array
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $id = Tenant::unscoped(fn () => Company::where('slug', 'hotel-atithi')->value('id'));
        $this->putJson("/api/admin/companies/$id", ['table_sharing_enabled' => $on], $admin)->assertOk()->assertJsonPath('table_sharing_enabled', $on);

        return $this->h('atithi@demo.test');
    }

    private function dish(array $o): int
    {
        $cat = $this->getJson('/api/menu/categories', $o)->json('0.id');

        return $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Tea'.uniqid(), 'price' => 100], $o)->assertCreated()->json('id');
    }

    public function test_it_is_off_until_the_platform_admin_switches_it_on(): void
    {
        $owner = $this->h('atithi@demo.test');
        $tid = $this->getJson('/api/tables', $owner)->json('0.id');
        $this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertJsonPath('company.table_sharing_enabled', false);
        $this->postJson("/api/tables/$tid/split", [], $owner)->assertForbidden();

        $owner = $this->enable();
        $this->postJson("/api/tables/$tid/split", [], $owner)->assertOk();
    }

    public function test_split_gives_two_parts_that_bill_separately_and_merge_when_paid(): void
    {
        $owner = $this->enable();
        $before = collect($this->getJson('/api/tables', $owner)->json());
        $t = $before->first();
        $dish = $this->dish($owner);

        $this->postJson("/api/tables/{$t['id']}/split", [], $owner)->assertOk()->assertJsonPath('is_split', true);
        $list = collect($this->getJson('/api/tables', $owner)->json());
        $this->assertCount($before->count() + 2, $list);
        $a = $list->firstWhere('number', $t['number'].'A');
        $b = $list->firstWhere('number', $t['number'].'B');
        $this->assertSame($t['id'], $a['parent_id']);

        // the shared table itself cannot take an order, its parts can
        $this->postJson('/api/orders', ['table_id' => $t['id'], 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $owner)->assertStatus(422);
        $oa = $this->postJson('/api/orders', ['table_id' => $a['id'], 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $owner)->assertCreated()->json();
        $ob = $this->postJson('/api/orders', ['table_id' => $b['id'], 'items' => [['food_item_id' => $dish, 'quantity' => 2]]], $owner)->assertCreated()->json();
        $this->assertNotSame($oa['id'], $ob['id']);

        // cannot merge while a part is open
        $this->postJson("/api/tables/{$t['id']}/merge", [], $owner)->assertStatus(422);

        foreach ([$oa, $ob] as $o) {
            $bill = $this->postJson("/api/orders/{$o['id']}/bill", [], $owner)->assertSuccessful()->json();
            $this->postJson('/api/bills/'.($bill['id'] ?? $bill['bill']['id']).'/pay', ['payments' => [['method' => 'cash', 'amount' => $bill['grand_total'] ?? $bill['bill']['grand_total']]]], $owner)->assertSuccessful();
        }

        // both paid: the table is one table again and the parts disappear from the list
        $after = collect($this->getJson('/api/tables', $owner)->json());
        $this->assertCount($before->count(), $after);
        $this->assertFalse($after->firstWhere('id', $t['id'])['is_split']);
        $this->assertSame('available', $after->firstWhere('id', $t['id'])['status']);
    }

    public function test_a_running_order_moves_to_part_a_and_manual_merge_works_when_idle(): void
    {
        $owner = $this->enable();
        $t = $this->getJson('/api/tables', $owner)->json('0');
        $dish = $this->dish($owner);
        $o = $this->postJson('/api/orders', ['table_id' => $t['id'], 'items' => [['food_item_id' => $dish, 'quantity' => 1]]], $owner)->assertCreated()->json();

        $this->postJson("/api/tables/{$t['id']}/split", [], $owner)->assertOk();
        $this->assertSame(1, \App\Models\Order::withoutGlobalScopes()->where('id', $o['id'])->whereHas('table', fn ($q) => $q->withoutGlobalScopes()->where('number', $t['number'].'A'))->count());

        // cancel it: the share closes by itself
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'cancelled', 'reason' => 'test'], $owner)->assertSuccessful();
        $this->assertFalse(collect($this->getJson('/api/tables', $owner)->json())->firstWhere('id', $t['id'])['is_split']);

        // split again (re-uses T1A / T1B) and merge by hand
        $this->postJson("/api/tables/{$t['id']}/split", [], $owner)->assertOk();
        $this->postJson("/api/tables/{$t['id']}/merge", [], $owner)->assertOk()->assertJsonPath('is_split', false);
        $this->postJson("/api/tables/{$t['id']}/merge", [], $owner)->assertStatus(422);
    }
}

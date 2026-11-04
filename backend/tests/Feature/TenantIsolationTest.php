<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\FoodItem;
use App\Models\HotelTable;
use App\Models\Order;
use App\Models\User;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class); // plans, permissions, super admin, Hotel Atithi (premium) + Friends Restaurant (premium)
        Tenant::clear();
    }

    /** The Sanctum guard memoises the user inside one test process; reset it so each request authenticates by its own token. */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function login(string $email, string $password = 'Demo@12345'): array
    {
        $res = $this->postJson('/api/auth/login', ['email' => $email, 'password' => $password])->assertOk();

        return ['Authorization' => 'Bearer '.$res->json('token')];
    }

    private function as(Company|string $nameOrCompany, string $role = 'owner'): array
    {
        $email = $nameOrCompany === 'atithi' ? 'atithi@demo.test' : 'friends@demo.test';

        return $this->login($role === 'owner' ? $email : "$role.$email");
    }

    /** Fetch a company's record bypassing scopes (test helper only). */
    private function ids(string $company): array
    {
        return Tenant::unscoped(function () use ($company) {
            $c = Company::where('name', $company === 'atithi' ? 'Hotel Atithi' : 'Friends Restaurant')->firstOrFail();

            return [
                'company' => $c,
                'table' => HotelTable::where('company_id', $c->id)->first(),
                'item' => FoodItem::where('company_id', $c->id)->first(),
                'qr' => \App\Models\TableQrToken::where('company_id', $c->id)->first(),
            ];
        });
    }

    public function test_registration_provisions_a_full_tenant(): void
    {
        $res = $this->postJson('/api/auth/register', [
            'company_name' => 'Shivraj Dhaba', 'owner_name' => 'Shivraj', 'phone' => '9876543210',
            'email' => 'shivraj@test.dev', 'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            'address' => 'NH4', 'city' => 'Satara', 'state' => 'MH', 'pin_code' => '415001',
        ])->assertCreated();

        $res->assertJsonPath('user.role', 'owner')->assertJsonPath('company.status', 'trial')->assertJsonPath('subscription.status', 'trial');
        $h = ['Authorization' => 'Bearer '.$res->json('token')];
        $this->getJson('/api/menu/categories', $h)->assertOk()->assertJsonCount(count(config('hms.default_categories')));
        $this->getJson('/api/tables', $h)->assertOk()->assertJsonCount(0); // no leakage of other companies' tables
    }

    public function test_company_a_cannot_list_company_b_data(): void
    {
        $a = $this->as('atithi');
        $b = $this->ids('friends');

        $tables = $this->getJson('/api/tables', $a)->assertOk()->json();
        $this->assertCount(3, $tables);
        $this->assertNotContains($b['table']->id, array_column($tables, 'id'));

        $items = collect($this->getJson('/api/menu/items', $a)->json())->pluck('name');
        $this->assertTrue($items->contains('Paneer Butter Masala'));
        $this->assertFalse($items->contains('Chicken Biryani'));

        $staff = collect($this->getJson('/api/staff', $a)->json())->pluck('email');
        $this->assertFalse($staff->contains('friends@demo.test'));
    }

    public function test_direct_id_access_to_other_tenants_records_is_404(): void
    {
        $a = $this->as('atithi');
        $b = $this->ids('friends');

        $this->putJson("/api/tables/{$b['table']->id}", ['capacity' => 99], $a)->assertNotFound();
        $this->deleteJson("/api/tables/{$b['table']->id}", [], $a)->assertNotFound();
        $this->getJson("/api/tables/{$b['table']->id}/qr", $a)->assertNotFound();
        $this->deleteJson("/api/menu/items/{$b['item']->id}", [], $a)->assertNotFound();
        $this->assertTrue(Tenant::unscoped(fn () => FoodItem::whereKey($b['item']->id)->exists()));

        $bUser = Tenant::unscoped(fn () => User::where('email', 'waiter.friends@demo.test')->first());
        $this->putJson("/api/staff/{$bUser->id}", ['name' => 'Hacked'], $a)->assertNotFound();
        $this->deleteJson("/api/staff/{$bUser->id}", [], $a)->assertNotFound();
    }

    public function test_cross_tenant_foreign_keys_are_rejected_on_write(): void
    {
        $a = $this->as('atithi');
        $b = $this->ids('friends');
        $ownTable = $this->ids('atithi')['table'];
        $ownItem = $this->ids('atithi')['item'];

        // Order using B's item
        $this->postJson('/api/orders', ['table_id' => $ownTable->id, 'items' => [['food_item_id' => $b['item']->id, 'quantity' => 1]]], $a)->assertStatus(422);
        // Order on B's table
        $this->postJson('/api/orders', ['table_id' => $b['table']->id, 'items' => [['food_item_id' => $ownItem->id, 'quantity' => 1]]], $a)->assertStatus(422);
        // A branch id from another company is never honoured: it is not even an accepted input anymore
        $bBranch = Tenant::unscoped(fn () => \App\Models\Branch::where('company_id', $b['company']->id)->first());
        $staffId = $this->postJson('/api/staff', ['name' => 'X', 'email' => 'x@x.test', 'password' => 'Secret123', 'role' => 'waiter', 'branch_id' => $bBranch->id], $a)->assertCreated()->json('id');
        $this->assertNull(Tenant::unscoped(fn () => \App\Models\User::find($staffId)->branch_id));
        // Item into B's category
        $bCat = Tenant::unscoped(fn () => \App\Models\FoodCategory::where('company_id', $b['company']->id)->first());
        $this->postJson('/api/menu/items', ['category_id' => $bCat->id, 'name' => 'Z', 'price' => 10], $a)->assertStatus(422);
        // A branch header pointing at B's branch is ignored: A still only sees its own tables
        $tables = $this->getJson('/api/tables', $a + ['X-Branch-Id' => (string) $bBranch->id])->assertOk()->json();
        $this->assertNotContains($b['table']->id, array_column($tables, 'id'));
    }

    public function test_company_id_in_request_body_is_ignored(): void
    {
        $a = $this->as('atithi');
        $b = $this->ids('friends');
        $cat = \App\Models\FoodCategory::class;
        $res = $this->postJson('/api/menu/categories', ['name' => 'Injected', 'company_id' => $b['company']->id], $a)->assertCreated();

        $row = Tenant::unscoped(fn () => $cat::find($res->json('id')));
        $this->assertSame($this->ids('atithi')['company']->id, $row->company_id);
        $names = collect($this->getJson('/api/menu/categories', $this->as('friends'))->json())->pluck('name');
        $this->assertFalse($names->contains('Injected'));
    }

    public function test_tenant_models_fail_closed_without_context(): void
    {
        Tenant::clear();
        $this->assertSame(0, FoodItem::count());
        $this->assertSame(0, HotelTable::count());
        $this->assertSame(0, Order::count());
        $this->expectException(\LogicException::class);
        FoodItem::create(['category_id' => 1, 'name' => 'x', 'price' => 1]);
    }

    public function test_waiter_cannot_see_profit_or_manage_business(): void
    {
        $waiter = $this->as('atithi', 'waiter');

        // Hidden from waiter: dashboard (profit), reports, expenses, staff, settings, menu editing
        $this->getJson('/api/dashboard', $waiter)->assertForbidden();
        $this->getJson('/api/reports/pnl', $waiter)->assertForbidden();
        $this->getJson('/api/expenses', $waiter)->assertForbidden();
        $this->getJson('/api/staff', $waiter)->assertForbidden();
        $this->postJson('/api/company', ['name' => 'Renamed'], $waiter)->assertForbidden();
        $this->postJson('/api/menu/categories', ['name' => 'x'], $waiter)->assertForbidden();
        // Allowed: tables, menu, orders, billing
        $this->getJson('/api/tables', $waiter)->assertOk();
        $this->getJson('/api/menu/items', $waiter)->assertOk();
        $this->getJson('/api/bills', $waiter)->assertOk();

        // Waiter can take an order, bill it and collect payment
        $mine = $this->ids('atithi');
        $order = $this->postJson('/api/orders', ['table_id' => $mine['table']->id, 'items' => [['food_item_id' => $mine['item']->id, 'quantity' => 1]]], $waiter)->assertCreated();
        $this->assertSame('accepted', $order->json('status')); // no kitchen step
        $bill = $this->postJson('/api/orders/'.$order->json('id').'/bill', [], $waiter)->assertCreated();
        $this->postJson('/api/bills/'.$bill->json('id').'/pay', ['payments' => [['method' => 'cash', 'amount' => $bill->json('grand_total')]]], $waiter)->assertOk();
        // Owner still sees profit/loss
        $this->getJson('/api/reports/pnl', $this->as('atithi'))->assertOk();
    }

    public function test_tenant_user_cannot_reach_super_admin(): void
    {
        $this->getJson('/api/admin/companies', $this->as('atithi'))->assertForbidden();
        $this->getJson('/api/admin/dashboard', $this->as('friends'))->assertForbidden();
    }

    public function test_super_admin_sees_platform_and_can_suspend(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $this->getJson('/api/admin/companies', $admin)->assertOk()->assertJsonPath('total', 2);
        $this->getJson('/api/admin/dashboard', $admin)->assertOk()->assertJsonPath('companies_total', 2);
        // Super admin has no company → tenant routes are refused
        $this->getJson('/api/tables', $admin)->assertForbidden();

        $a = $this->as('atithi');
        $c = $this->ids('atithi')['company'];
        $this->patchJson("/api/admin/companies/{$c->id}/status", ['status' => 'suspended'], $admin)->assertOk();
        $this->getJson('/api/tables', $a)->assertUnauthorized(); // tokens revoked
        $this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertStatus(422);
        // Friends is unaffected
        $this->getJson('/api/tables', $this->as('friends'))->assertOk();
    }

    public function test_qr_token_only_works_for_its_own_company(): void
    {
        $a = $this->ids('atithi');
        $b = $this->ids('friends');
        $base = fn ($slug, $token) => "/api/public/menu/$slug/table/$token";

        $this->getJson($base($a['company']->slug, $a['qr']->token))->assertOk()
            ->assertJsonPath('company.name', 'Hotel Atithi')
            ->assertJsonFragment(['name' => 'Paneer Butter Masala'])
            ->assertJsonMissing(['name' => 'Chicken Biryani']);

        // Token of A replayed on B's slug (and vice versa) must not resolve
        $this->getJson($base($b['company']->slug, $a['qr']->token))->assertNotFound();
        $this->getJson($base($a['company']->slug, $b['qr']->token))->assertNotFound();
        $this->getJson($base($a['company']->slug, 'guessed-token'))->assertNotFound();

        // Ordering via QR lands on the correct company + table; B's items are refused
        $this->postJson($base($a['company']->slug, $a['qr']->token).'/orders', ['items' => [['food_item_id' => $b['item']->id, 'quantity' => 1]]])->assertStatus(422);
        $res = $this->postJson($base($a['company']->slug, $a['qr']->token).'/orders', ['items' => [['food_item_id' => $a['item']->id, 'quantity' => 2]]])->assertCreated();

        $order = Tenant::unscoped(fn () => Order::where('order_no', $res->json('order_no'))->first());
        $this->assertSame($a['company']->id, $order->company_id);
        $this->assertSame($a['table']->id, $order->table_id);
        $this->assertSame('qr', $order->source);
        $this->assertSame('occupied', Tenant::unscoped(fn () => $a['table']->fresh()->status));
        $this->getJson($base($a['company']->slug, $a['qr']->token).'/orders/'.$res->json('order_no'))->assertOk()->assertJsonPath('status', 'pending');
        // B's owner never sees A's order
        $this->assertCount(0, $this->getJson('/api/orders', $this->as('friends'))->json());
        $this->assertCount(1, $this->getJson('/api/orders', $this->as('atithi'))->json());
    }

    public function test_billing_uses_server_prices_and_settles_table(): void
    {
        $a = $this->as('atithi');
        $mine = $this->ids('atithi');

        $order = $this->postJson('/api/orders', [
            'table_id' => $mine['table']->id,
            'items' => [['food_item_id' => $mine['item']->id, 'quantity' => 2, 'price' => 1]], // client price must be ignored
        ], $a)->assertCreated();
        $price = (float) $mine['item']->price;

        $bill = $this->postJson('/api/orders/'.$order->json('id').'/bill', [], $a)->assertCreated();
        $expected = round($price * 2 * 1.05, 2);
        $this->assertEqualsWithDelta($expected, (float) $bill->json('grand_total'), 0.01);

        // Underpayment refused
        $this->postJson('/api/bills/'.$bill->json('id').'/pay', ['payments' => [['method' => 'cash', 'amount' => 1]]], $a)->assertStatus(422);
        $this->postJson('/api/bills/'.$bill->json('id').'/pay', ['payments' => [['method' => 'upi', 'amount' => $expected]]], $a)->assertOk();
        $this->assertSame('available', Tenant::unscoped(fn () => $mine['table']->fresh()->status));
        // Double pay refused
        $this->postJson('/api/bills/'.$bill->json('id').'/pay', ['payments' => [['method' => 'cash', 'amount' => $expected]]], $a)->assertStatus(422);

        // B cannot see or pay A's bill
        $f = $this->as('friends');
        $this->getJson('/api/bills/'.$bill->json('id'), $f)->assertNotFound();
        $this->postJson('/api/bills/'.$bill->json('id').'/pay', ['payments' => [['method' => 'cash', 'amount' => 1000]]], $f)->assertNotFound();

        $this->assertEqualsWithDelta($expected, $this->getJson('/api/dashboard', $a)->assertOk()->json('today_sales'), 0.01);
        $this->assertEquals(0, $this->getJson('/api/dashboard', $f)->assertOk()->json('today_sales'));
        $this->getJson('/api/reports/payments?from='.now()->toDateString(), $a)->assertOk()->assertJsonPath('0.method', 'upi');
    }

    public function test_single_premium_plan_unlocks_everything(): void
    {
        $this->assertSame(['premium'], \App\Models\SubscriptionPlan::where('is_active', true)->pluck('slug')->all());

        $f = $this->as('friends');
        $this->getJson('/api/expenses', $f)->assertOk();
        $this->getJson('/api/inventory', $f)->assertOk();
        // Branch management was removed from the product
        $this->getJson('/api/branches', $f)->assertNotFound();
        $this->postJson('/api/branches', ['name' => 'Pune Branch'], $f)->assertStatus(404);
    }

    public function test_limits_are_enforced_for_a_restricted_plan(): void
    {
        // Plans remain data-driven: a limited plan (if ever created by super admin) is enforced.
        $plan = \App\Models\SubscriptionPlan::create(['name' => 'Tiny', 'slug' => 'tiny', 'max_staff' => 3, 'max_tables' => 2, 'max_branches' => 1, 'features' => ['qr']]);
        $reg = $this->postJson('/api/auth/register', [
            'company_name' => 'Tiny Cafe', 'owner_name' => 'T', 'phone' => '9', 'email' => 'tiny@test.dev', 'password' => 'Secret123', 'password_confirmation' => 'Secret123',
            'address' => 'x', 'city' => 'x', 'state' => 'x', 'pin_code' => '1', 'plan_id' => $plan->id,
        ])->assertCreated();
        $t = ['Authorization' => 'Bearer '.$reg->json('token')];
        foreach (['a', 'b'] as $n) {
            $this->postJson('/api/staff', ['name' => $n, 'email' => "$n@tiny.dev", 'password' => 'Secret123', 'role' => 'waiter'], $t)->assertCreated();
        }
        $this->postJson('/api/staff', ['name' => 'c', 'email' => 'c@tiny.dev', 'password' => 'Secret123', 'role' => 'waiter'], $t)->assertStatus(402);
        $this->postJson('/api/tables', ['number' => '1', 'capacity' => 2], $t)->assertCreated();
        $this->postJson('/api/tables', ['number' => '2', 'capacity' => 2], $t)->assertCreated();
        $this->postJson('/api/tables', ['number' => '3', 'capacity' => 2], $t)->assertStatus(402);
        $this->getJson('/api/expenses', $t)->assertStatus(402)->assertJsonPath('code', 'feature_locked');
    }

    public function test_expired_subscription_is_read_only_and_data_is_preserved(): void
    {
        $a = $this->as('atithi');
        $c = $this->ids('atithi')['company'];
        \App\Models\Subscription::where('company_id', $c->id)->update(['ends_at' => now()->subDay(), 'status' => 'expired']);

        $this->getJson('/api/tables', $a)->assertOk()->assertJsonCount(3);            // data preserved & readable
        $this->postJson('/api/menu/categories', ['name' => 'Nope'], $a)->assertStatus(402)->assertJsonPath('code', 'subscription_expired');
        $this->getJson('/api/subscription', $a)->assertOk();                          // renewal path stays open

        $planId = \App\Models\SubscriptionPlan::where('slug', 'premium')->value('id');
        $this->postJson('/api/subscription', ['plan_id' => $planId, 'billing_cycle' => 'monthly'], $a)->assertCreated();
        $this->postJson('/api/menu/categories', ['name' => 'Back'], $a)->assertCreated();
    }

    public function test_public_qr_menu_is_blocked_when_company_expired(): void
    {
        $x = $this->ids('atithi');
        \App\Models\Subscription::where('company_id', $x['company']->id)->update(['ends_at' => now()->subDay()]);
        $this->getJson("/api/public/menu/{$x['company']->slug}/table/{$x['qr']->token}")->assertNotFound();
    }

    public function test_regenerating_qr_invalidates_old_token(): void
    {
        $a = $this->as('atithi');
        $x = $this->ids('atithi');
        $old = $x['qr']->token;
        $this->postJson("/api/tables/{$x['table']->id}/qr/regenerate", [], $a)->assertOk();
        $this->getJson("/api/public/menu/{$x['company']->slug}/table/$old")->assertNotFound();
        $this->getJson("/api/tables/{$x['table']->id}/qr", $a)->assertOk()->assertHeader('Content-Type', 'image/svg+xml');
    }

    public function test_super_admin_can_save_a_plan_that_still_carries_the_removed_multi_branch_flag(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $plan = \App\Models\SubscriptionPlan::where('slug', 'premium')->first();
        $res = $this->putJson("/api/admin/plans/{$plan->id}", [
            'name' => 'Premium', 'slug' => 'premium', 'price_monthly' => 3499, 'price_yearly' => 34990,
            'max_staff' => null, 'max_tables' => null, 'trial_days' => 14, 'is_active' => true,
            'features' => ['qr', 'multi_branch', 'reports'], // legacy flag from older data
        ], $admin)->assertOk();
        $this->assertSame(['qr', 'reports'], $res->json('features'));
    }
}

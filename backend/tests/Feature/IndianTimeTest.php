<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Carbon\Carbon;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** A day is an Indian day: it starts at midnight IST (18:30 UTC the evening before), whatever the server clock says. */
class IndianTimeTest extends TestCase
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

    private function sale(array $h): array
    {
        return $this->postJson('/api/orders', ['generate_bill' => true, 'items' => [['food_item_id' => $this->getJson('/api/menu/items', $h)->json('0.id'), 'quantity' => 1]]], $h)->assertCreated()->json();
    }

    public function test_bill_and_order_numbers_restart_at_midnight_in_india(): void
    {
        $owner = $this->login('atithi@demo.test');

        Carbon::setTestNow(Carbon::parse('2026-11-15 17:00:00', 'UTC'));   // 22:30 IST on 15 Nov
        $late = $this->sale($owner);
        Carbon::setTestNow(Carbon::parse('2026-11-15 19:00:00', 'UTC'));   // 00:30 IST on 16 Nov (still 15 Nov in UTC)
        $after = $this->sale($owner);
        Carbon::setTestNow(Carbon::parse('2026-11-16 05:00:00', 'UTC'));   // 10:30 IST on 16 Nov
        $morning = $this->sale($owner);

        $this->assertSame('BILL-261115-0001', $late['bill']['bill_no']);
        $this->assertSame('BILL-261116-0001', $after['bill']['bill_no']);       // a new Indian day: numbering restarts
        $this->assertSame('BILL-261116-0002', $morning['bill']['bill_no']);
        $this->assertStringStartsWith('ORD-261116-', $after['order_no']);
    }

    public function test_today_and_date_filters_follow_the_indian_day(): void
    {
        $owner = $this->login('atithi@demo.test');
        Carbon::setTestNow(Carbon::parse('2026-11-15 19:00:00', 'UTC'));   // 00:30 IST on 16 Nov
        $this->sale($owner);

        $ids = fn (string $url) => collect($this->getJson($url, $owner)->assertOk()->json())->pluck('bill_no')->all();
        $this->assertCount(1, $ids('/api/bills?date=2026-11-16'));          // belongs to the 16th in India
        $this->assertCount(0, $ids('/api/bills?date=2026-11-15'));
        $this->assertCount(1, $this->getJson('/api/orders?date=2026-11-16', $owner)->json());
        $this->assertCount(0, $this->getJson('/api/orders?date=2026-11-15', $owner)->json());
    }

    public function test_reports_group_sales_by_indian_day_and_dashboard_today_includes_it(): void
    {
        $owner = $this->login('atithi@demo.test');
        Carbon::setTestNow(Carbon::parse('2026-11-15 19:00:00', 'UTC'));   // 00:30 IST on 16 Nov
        $bill = $this->sale($owner)['bill'];
        $this->postJson('/api/bills/'.$bill['id'].'/pay', ['payments' => [['method' => 'cash', 'amount' => $bill['grand_total']]]], $owner)->assertOk();

        $rows = $this->getJson('/api/reports/sales?from=2026-11-16&to=2026-11-16', $owner)->assertOk()->json('rows');
        $this->assertSame('2026-11-16', $rows[0]['period']);                // not 15 Nov
        $this->assertEquals((float) $bill['grand_total'], (float) $rows[0]['sales']);
        $this->assertSame([], $this->getJson('/api/reports/sales?from=2026-11-15&to=2026-11-15', $owner)->json('rows'));

        Carbon::setTestNow(Carbon::parse('2026-11-15 20:00:00', 'UTC'));   // 01:30 IST on 16 Nov
        $this->assertEquals((float) $bill['grand_total'], (float) $this->getJson('/api/dashboard', $owner)->assertOk()->json('today_sales'));
    }

    public function test_kot_numbers_restart_at_indian_midnight(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('slug', 'hotel-atithi')->value('id');
        $this->putJson("/api/admin/companies/$id", ['kot_enabled' => true], $admin)->assertOk();
        $owner = $this->login('atithi@demo.test');
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $food = $this->getJson('/api/menu/items', $owner)->json('0.id');
        $place = fn () => $this->postJson('/api/orders', ['table_id' => $table, 'type' => 'dine_in', 'items' => [['food_item_id' => $food, 'quantity' => 1]]], $owner)->assertCreated()->json('kot.number');

        Carbon::setTestNow(Carbon::parse('2026-11-15 17:00:00', 'UTC'));   // 22:30 IST
        $first = $place();
        Carbon::setTestNow(Carbon::parse('2026-11-15 19:00:00', 'UTC'));   // 00:30 IST next day
        $second = $place();
        $this->assertSame(1, $first);
        $this->assertSame(1, $second);                                      // the kitchen's day started over at midnight
    }
}

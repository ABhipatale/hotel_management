<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Company;
use App\Models\TableQrToken;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Owner approval PIN, staff discount limit, bill voids, cancelling started orders, the exceptions report, the QR order cap. */
class ApprovalControlsTest extends TestCase
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

    private function waiter(array $owner): array
    {
        $this->postJson('/api/staff', ['name' => 'Wally', 'email' => 'wally@x.test', 'password' => '123456', 'role' => 'waiter'], $owner)->assertCreated();

        return $this->login('wally@x.test', '123456');
    }

    private function order(array $h, int $qty = 1): array
    {
        return $this->postJson('/api/orders', ['items' => [['food_item_id' => $this->getJson('/api/menu/items', $h)->json('0.id'), 'quantity' => $qty]]], $h)->assertCreated()->json();
    }

    private function setPin(array $owner, string $pin = '4821'): void
    {
        $this->putJson('/api/approvals', ['pin' => $pin], $owner)->assertOk()->assertJsonPath('has_pin', true);
    }

    public function test_the_pin_is_hashed_hidden_and_only_the_owner_can_change_it(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $this->getJson('/api/approvals', $owner)->assertOk()->assertJsonPath('has_pin', false)->assertJsonPath('staff_discount_percent', 10);

        $this->putJson('/api/approvals', ['pin' => '12'], $owner)->assertStatus(422);        // too short
        $this->putJson('/api/approvals', ['pin' => 'abcd'], $owner)->assertStatus(422);      // digits only
        $this->putJson('/api/approvals', ['pin' => '4821', 'staff_discount_percent' => 5], $owner)->assertOk()->assertJsonPath('has_pin', true)->assertJsonPath('staff_discount_percent', 5);
        $this->putJson('/api/approvals', ['pin' => '999999'], $waiter)->assertForbidden();   // staff cannot

        $this->assertStringNotContainsString('4821', $this->getJson('/api/approvals', $owner)->getContent());
        $this->assertStringNotContainsString('approval_pin', $this->getJson('/api/company', $owner)->getContent());
        $this->assertStringNotContainsString('approval_pin', $this->getJson('/api/auth/me', $owner)->getContent());
        $stored = Company::where('slug', 'hotel-atithi')->value('approval_pin');
        $this->assertNotSame('4821', $stored);
        $this->assertTrue(password_verify('4821', $stored));

        $this->putJson('/api/approvals', ['clear_pin' => true], $owner)->assertOk()->assertJsonPath('has_pin', false);
    }

    public function test_staff_discount_limit_and_pin(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $order = $this->order($waiter);                       // 1 dish = 240.00
        $url = '/api/orders/'.$order['id'].'/bill';

        // above 10% (24.00) and no PIN set: refused, and the message says the owner must set a PIN
        $this->postJson($url, ['extra_discount' => 100], $waiter)->assertForbidden()->assertJsonPath('code', 'approval_required')->assertJsonPath('has_pin', false);

        $this->setPin($owner);
        $this->postJson($url, ['extra_discount' => 100], $waiter)->assertForbidden()->assertJsonPath('has_pin', true);                       // PIN needed
        $this->postJson($url, ['extra_discount' => 100], $waiter + ['X-Approval-Pin' => '0000'])->assertForbidden();                          // wrong PIN
        $this->assertSame(0, \App\Models\Bill::count());                                                                                       // nothing was billed by the refusals

        $bill = $this->postJson($url, ['extra_discount' => 100], $waiter + ['X-Approval-Pin' => '4821'])->assertCreated()->json();           // right PIN
        $this->assertEquals(100.0, (float) $bill['discount']);

        $log = AuditLog::where('action', 'bill.generate')->latest('id')->first();
        $this->assertSame('pin', $log->meta['approved']);
        $this->assertEquals(100.0, (float) $log->meta['extra_discount']);
    }

    public function test_a_small_staff_discount_needs_no_pin_and_the_owner_is_never_asked(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $this->setPin($owner);

        $this->postJson('/api/orders/'.$this->order($waiter)['id'].'/bill', ['extra_discount' => 24], $waiter)->assertCreated();            // exactly 10%
        $this->postJson('/api/orders/'.$this->order($owner)['id'].'/bill', ['extra_discount' => 200], $owner)->assertCreated();              // owner: any amount
        $this->assertSame(['within limit', 'owner'], AuditLog::where('action', 'bill.generate')->orderBy('id')->get()->map(fn ($l) => $l->meta['approved'])->all());
    }

    public function test_wrong_pins_are_throttled(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $this->setPin($owner);
        $url = '/api/orders/'.$this->order($waiter)['id'].'/bill';

        foreach (range(1, 5) as $i) {
            $this->postJson($url, ['extra_discount' => 100], $waiter + ['X-Approval-Pin' => '000'.$i])->assertForbidden();
        }
        // locked now, even for the right PIN
        $this->postJson($url, ['extra_discount' => 100], $waiter + ['X-Approval-Pin' => '4821'])->assertStatus(429)->assertJsonPath('code', 'approval_locked');
    }

    public function test_voiding_a_bill_needs_the_owner_or_the_pin_and_always_a_reason(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $bill = $this->postJson('/api/orders/'.$this->order($owner)['id'].'/bill', [], $owner)->assertCreated()->json();
        $url = '/api/bills/'.$bill['id'];

        $this->deleteJson($url, [], $waiter)->assertStatus(422);                                                                              // no reason
        $this->deleteJson($url, ['reason' => 'customer left'], $waiter)->assertForbidden()->assertJsonPath('has_pin', false);                // no PIN exists yet
        $this->setPin($owner);
        $this->deleteJson($url, ['reason' => 'customer left'], $waiter)->assertForbidden()->assertJsonPath('has_pin', true);
        $this->deleteJson($url, ['reason' => 'customer left'], $waiter + ['X-Approval-Pin' => '4821'])->assertNoContent();

        $log = AuditLog::where('action', 'bill.void')->first();
        $this->assertSame('customer left', $log->meta['reason']);
        $this->assertSame('pin', $log->meta['approved']);
        $this->assertEquals(240.0 * 1.05, (float) $log->meta['total']);                                                                       // 240 + 5% GST
    }

    public function test_voiding_a_bill_does_not_break_the_next_bill_number(): void
    {
        $owner = $this->login('atithi@demo.test');
        $mk = fn () => $this->postJson('/api/orders', ['generate_bill' => true, 'items' => [['food_item_id' => $this->getJson('/api/menu/items', $owner)->json('0.id'), 'quantity' => 1]]], $owner)->assertCreated()->json('bill');
        [$a, $b, $c] = [$mk(), $mk(), $mk()];
        $this->deleteJson('/api/bills/'.$b['id'], ['reason' => 'test'], $owner)->assertNoContent();     // void the MIDDLE bill
        $next = $mk();                                                                                    // used to fail with a server error (duplicate number)
        $this->assertNotSame($c['bill_no'], $next['bill_no']);
        $this->assertStringEndsWith('-0004', $next['bill_no']);
    }

    public function test_cancelling_a_started_order_needs_the_pin_only_when_one_is_set(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);

        // no PIN set: exactly as before
        $first = $this->order($waiter);
        $this->patchJson('/api/orders/'.$first['id'].'/status', ['status' => 'preparing'], $waiter)->assertOk();
        $this->patchJson('/api/orders/'.$first['id'].'/status', ['status' => 'cancelled'], $waiter)->assertOk();

        $this->setPin($owner);
        $second = $this->order($waiter, 2);
        $url = '/api/orders/'.$second['id'].'/status';
        $this->patchJson($url, ['status' => 'preparing'], $waiter)->assertOk();
        $this->patchJson($url, ['status' => 'cancelled'], $waiter)->assertForbidden()->assertJsonPath('code', 'approval_required');
        $this->patchJson($url, ['status' => 'cancelled'], $waiter + ['X-Approval-Pin' => '4821'])->assertOk();

        $log = AuditLog::where('action', 'order.cancel')->latest('id')->first();
        $this->assertSame('preparing', $log->meta['status_before']);
        $this->assertEquals(480.0, (float) $log->meta['amount']);
        $this->assertSame('pin', $log->meta['approved']);

        // an order nobody started yet can still be cancelled freely
        $third = $this->order($waiter);
        $this->patchJson('/api/orders/'.$third['id'].'/status', ['status' => 'cancelled'], $waiter)->assertOk();
    }

    public function test_the_exceptions_report_lists_it_all_and_stays_inside_the_company(): void
    {
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->waiter($owner);
        $this->setPin($owner);
        $bill = $this->postJson('/api/orders/'.$this->order($owner)['id'].'/bill', ['extra_discount' => 40], $owner)->assertCreated()->json();
        $this->deleteJson('/api/bills/'.$bill['id'], ['reason' => 'wrong table'], $owner)->assertNoContent();
        $o = $this->order($waiter, 3);
        $this->patchJson('/api/orders/'.$o['id'].'/status', ['status' => 'preparing'], $waiter)->assertOk();
        $this->patchJson('/api/orders/'.$o['id'].'/status', ['status' => 'cancelled', 'reason' => 'Customer left'], $waiter + ['X-Approval-Pin' => '4821'])->assertOk();

        $r = $this->getJson('/api/reports/exceptions?from='.\App\Support\BizTime::today().'&to='.\App\Support\BizTime::today(), $owner)->assertOk();
        $this->assertCount(1, $r->json('voids'));
        $this->assertSame('wrong table', $r->json('voids.0.reason'));
        $this->assertCount(1, $r->json('discounts'));
        $this->assertEquals(40.0, (float) $r->json('totals.discounts'));
        $this->assertCount(1, $r->json('cancellations'));
        $this->assertSame('Wally', $r->json('cancellations.0.by'));
        $this->assertSame('Customer left', $r->json('cancellations.0.reason')); // the reason is saved and shown
        $this->assertEquals(720.0, (float) $r->json('totals.cancellations'));

        $this->getJson('/api/reports/exceptions', $waiter)->assertForbidden();                              // a waiter has no reports
        $other = $this->login('friends@demo.test');
        $this->getJson('/api/reports/exceptions', $other)->assertOk()->assertJsonPath('totals.voids', 0)->assertJsonCount(0, 'voids'); // another company sees nothing
    }

    public function test_qr_orders_are_capped_per_table_until_staff_accept_them(): void
    {
        $owner = $this->login('atithi@demo.test');
        [$slug, $token] = Tenant::unscoped(function () {
            $c = Company::where('slug', 'hotel-atithi')->firstOrFail();

            return [$c->slug, TableQrToken::where('company_id', $c->id)->firstOrFail()->token];
        });
        $food = $this->getJson('/api/menu/items', $owner)->json('0.id');
        $url = "/api/public/menu/$slug/table/$token/orders";
        $body = ['items' => [['food_item_id' => $food, 'quantity' => 1]]];

        $ids = [];
        foreach (range(1, 3) as $i) {
            $ids[] = $this->postJson($url, $body)->assertCreated()->json('order_no');
        }
        $this->postJson($url, $body)->assertStatus(429);                                  // the 4th waits
        $first = \App\Models\Order::withoutGlobalScopes()->where('order_no', $ids[0])->value('id');
        $this->patchJson("/api/orders/$first/status", ['status' => 'accepted'], $owner)->assertOk();
        $this->postJson($url, $body)->assertCreated();                                    // one was accepted: room for another
    }
}

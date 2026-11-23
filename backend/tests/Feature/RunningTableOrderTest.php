<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\FoodItem;
use App\Models\HotelTable;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Tapping a busy table opens its running order with the dishes already on it (like Edit order).
 * Saving sends the kitchen only what changed: the new dishes on a KOT, the reduced ones on a cancel slip.
 * The screen sends `base` (the dishes it loaded), so dishes a colleague added meanwhile are kept.
 */
class RunningTableOrderTest extends TestCase
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

    private function switchKot(bool $on): void
    {
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['kot_enabled' => $on], $this->login('admin@hms.test', 'Admin@12345'))->assertOk();
    }

    /** @return array{0:int,1:int,2:int} three dish ids */
    private function dishes(array $h): array
    {
        return collect($this->getJson('/api/menu/items', $h)->json())->take(3)->pluck('id')->all();
    }

    private function kots(array $h): \Illuminate\Support\Collection
    {
        return collect($this->getJson('/api/kots', $h)->assertOk()->json())->sortBy('id')->values();
    }

    /** active quantity per dish */
    private function active(array $order): array
    {
        return collect($order['items'])->where('status', '!=', 'cancelled')->groupBy('food_item_id')->map(fn ($g) => $g->sum('quantity'))->sortKeys()->all();
    }

    public function test_a_dish_added_twice_earlier_is_not_cancelled_and_resent_when_a_new_dish_is_added(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        [$soup, $naan] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');

        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 2]]], $owner)->assertCreated()->json();
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated(); // later: one more soup (a second line)
        $before = $this->kots($owner)->count();

        // the screen shows soup x3 and the waiter adds a naan
        $res = $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 3], ['food_item_id' => $naan, 'quantity' => 1]],
            'base' => [['food_item_id' => $soup, 'quantity' => 3]],
        ], $owner)->assertOk();

        $this->assertSame([$soup => 3, $naan => 1], $this->active($res->json()));
        $fresh = $this->kots($owner)->slice($before)->values();
        $this->assertCount(1, $fresh, 'only one new slip, no cancel slip');
        $this->assertSame('new', $fresh[0]['type']);
        $this->assertSame([[$naan, 1]], collect($fresh[0]['items'])->map(fn ($i) => [collect($res->json('items'))->firstWhere('id', $i['order_item_id'])['food_item_id'], $i['quantity']])->all());
        // the app gets the slip(s) of this save, to print them on this device
        $this->assertSame($fresh[0]['id'], $res->json('kot.id'));
        $this->assertSame([$fresh[0]['id']], collect($res->json('kots'))->pluck('id')->all());
    }

    public function test_an_old_app_without_base_no_longer_sends_a_wrong_add_and_cancel_for_a_dish_on_two_lines(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        [$soup, $naan] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 2]]], $owner)->assertCreated()->json();
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated();
        $before = $this->kots($owner)->count();

        $this->putJson("/api/orders/{$o['id']}/items", ['items' => [['food_item_id' => $soup, 'quantity' => 3], ['food_item_id' => $naan, 'quantity' => 1]]], $owner)->assertOk();

        $fresh = $this->kots($owner)->slice($before)->values();
        $this->assertSame(['new'], $fresh->pluck('type')->all());
        $this->assertSame([1], collect($fresh[0]['items'])->pluck('quantity')->all()); // just the naan
    }

    public function test_dishes_a_colleague_added_meanwhile_are_kept(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        $waiter = $this->login('waiter.atithi@demo.test');
        [$soup, $naan, $dal] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 2]]], $owner)->assertCreated()->json();

        // the owner opens the table (soup x2) ... meanwhile the waiter adds a naan from another phone
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $naan, 'quantity' => 1]]], $waiter)->assertCreated();
        $before = $this->kots($owner)->count();

        // ... and the owner saves soup x2 + dal x1
        $res = $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 2], ['food_item_id' => $dal, 'quantity' => 1]],
            'base' => [['food_item_id' => $soup, 'quantity' => 2]],
        ], $owner)->assertOk();

        $this->assertSame(collect([$soup => 2, $naan => 1, $dal => 1])->sortKeys()->all(), $this->active($res->json()));
        $fresh = $this->kots($owner)->slice($before)->values();
        $this->assertSame(['new'], $fresh->pluck('type')->all()); // no cancel slip for the colleague's naan
        $this->assertSame([1], collect($fresh[0]['items'])->pluck('quantity')->all());
    }

    public function test_reducing_takes_the_newest_lines_first_and_sends_a_cancel_slip(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        [$soup] = $this->dishes($owner);
        Tenant::unscoped(fn () => FoodItem::withoutGlobalScopes()->where('id', $soup)->update(['stock' => 20]));
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 2]]], $owner)->assertCreated()->json();
        $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated();
        $before = $this->kots($owner)->count();

        // soup 3 -> 1
        $res = $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 1]],
            'base' => [['food_item_id' => $soup, 'quantity' => 3]],
        ], $owner)->assertOk();

        $lines = collect($res->json('items'))->where('food_item_id', $soup)->sortBy('id')->values();
        $this->assertSame([[1, 'accepted'], [1, 'cancelled']], $lines->map(fn ($l) => [$l['quantity'], $l['status'] === 'cancelled' ? 'cancelled' : 'accepted'])->all());
        $fresh = $this->kots($owner)->slice($before)->values();
        $this->assertSame(['cancel'], $fresh->pluck('type')->all());
        $this->assertSame(2, collect($fresh[0]['items'])->sum('quantity'));
        $this->assertNull($res->json('kot')); // nothing new to cook
        $this->assertSame([$fresh[0]['id']], collect($res->json('kots'))->pluck('id')->all());
        $this->assertSame(19, Tenant::unscoped(fn () => FoodItem::withoutGlobalScopes()->find($soup)->stock)); // 20 - 3 + 2
    }

    public function test_adding_to_a_served_table_puts_it_back_to_preparing_and_the_note_reaches_the_slip(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        [$soup, $naan] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'notes' => 'window seat', 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated()->json();
        $this->patchJson("/api/orders/{$o['id']}/status", ['status' => 'served'], $owner)->assertOk();

        $res = $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 1], ['food_item_id' => $naan, 'quantity' => 2]],
            'base' => [['food_item_id' => $soup, 'quantity' => 1]],
            'kot_note' => 'less spicy',
        ], $owner)->assertOk();

        $this->assertSame('preparing', $res->json('status'));
        $this->assertSame('occupied', Tenant::unscoped(fn () => HotelTable::withoutGlobalScopes()->find($table)->status));
        $this->assertSame('window seat | less spicy', $res->json('notes'));
        $this->assertSame('less spicy', $res->json('kot.note'));
    }

    public function test_with_kot_switched_off_nothing_reaches_a_kitchen_and_the_answer_has_no_slip(): void
    {
        $owner = $this->login('atithi@demo.test');
        [$soup, $naan] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated()->json();

        $res = $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 1], ['food_item_id' => $naan, 'quantity' => 1]],
            'base' => [['food_item_id' => $soup, 'quantity' => 1]],
        ], $owner)->assertOk();

        $this->assertSame([$soup => 1, $naan => 1], $this->active($res->json()));
        $this->assertArrayNotHasKey('kot', $res->json());
        $this->assertSame(0, \App\Models\Kot::withoutGlobalScopes()->count());
    }

    public function test_saving_again_after_a_lost_answer_does_not_add_the_dishes_twice(): void
    {
        $this->switchKot(true);
        $owner = $this->login('atithi@demo.test');
        [$soup, $naan] = $this->dishes($owner);
        $table = $this->getJson('/api/tables', $owner)->json('0.id');
        $o = $this->postJson('/api/orders', ['table_id' => $table, 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated()->json();
        $before = $this->kots($owner)->count();
        $save = [
            'items' => [['food_item_id' => $soup, 'quantity' => 1], ['food_item_id' => $naan, 'quantity' => 1]],
            'base' => [['food_item_id' => $soup, 'quantity' => 1]],
            'client_ref' => 'abc123def456abc123def456',
        ];

        $this->putJson("/api/orders/{$o['id']}/items", $save, $owner)->assertOk();
        $again = $this->putJson("/api/orders/{$o['id']}/items", $save, $owner)->assertOk(); // the same save, sent again

        $this->assertSame([$soup => 1, $naan => 1], $this->active($again->json()));
        $this->assertCount(1, $this->kots($owner)->slice($before));
        // an offline order with the same reference text is a different thing (its own namespace)
        $this->postJson('/api/orders', ['type' => 'takeaway', 'client_ref' => 'abc123def456abc123def456', 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated();
    }

    public function test_base_dishes_from_another_hotel_are_refused(): void
    {
        $owner = $this->login('atithi@demo.test');
        $other = $this->login('friends@demo.test');
        [$soup] = $this->dishes($owner);
        [$foreign] = $this->dishes($other);
        $o = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $soup, 'quantity' => 1]]], $owner)->assertCreated()->json();

        $this->putJson("/api/orders/{$o['id']}/items", [
            'items' => [['food_item_id' => $soup, 'quantity' => 1]],
            'base' => [['food_item_id' => $foreign, 'quantity' => 1]],
        ], $owner)->assertStatus(422);
    }
}

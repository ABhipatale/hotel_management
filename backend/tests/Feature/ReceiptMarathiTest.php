<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The bill payload carries each dish's Marathi name so the receipt can be printed in Marathi. */
class ReceiptMarathiTest extends TestCase
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

    private function h(string $email): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    public function test_bill_items_include_the_marathi_dish_name(): void
    {
        $owner = $this->h('atithi@demo.test');
        $cat = $this->getJson('/api/menu/categories', $owner)->json('0.id');
        $mr = "\u{0926}\u{093E}\u{0932} \u{0924}\u{0921}\u{0915}\u{093E}";
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Marathi Dal', 'name_mr' => $mr, 'price' => 100], $owner)->assertCreated()->json();
        $plain = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Only English', 'price' => 50], $owner)->assertCreated()->json();

        $bill = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [
            ['food_item_id' => $dish['id'], 'quantity' => 1], ['food_item_id' => $plain['id'], 'quantity' => 2],
        ]], $owner)->assertCreated()->json('bill');

        $items = collect($this->getJson('/api/bills/'.$bill['id'], $owner)->assertOk()->json('bill.items'))->keyBy('name');
        $this->assertSame($mr, $items['Marathi Dal']['name_mr']);
        $this->assertNull($items['Only English']['name_mr']);
    }

    public function test_variant_marathi_name_is_saved_and_used_on_the_bill(): void
    {
        $owner = $this->h('atithi@demo.test');
        $cat = $this->getJson('/api/menu/categories', $owner)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Dal Fry', 'name_mr' => 'डाळ फ्राय', 'price' => 100,
            'variants' => [['name' => 'Half', 'name_mr' => 'अर्धा', 'price' => 60], ['name' => 'Full', 'price' => 100]]], $owner)->assertCreated()->json();
        $v = collect($dish['variants'])->keyBy('name');
        $this->assertSame('अर्धा', $v['Half']['name_mr']);
        $this->assertNull($v['Full']['name_mr']); // optional

        $bill = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [
            ['food_item_id' => $dish['id'], 'variant_id' => $v['Half']['id'], 'quantity' => 1], ['food_item_id' => $dish['id'], 'variant_id' => $v['Full']['id'], 'quantity' => 1],
        ]], $owner)->assertCreated()->json('bill');
        $items = collect($this->getJson('/api/bills/'.$bill['id'], $owner)->assertOk()->json('bill.items'))->keyBy('name');
        $this->assertSame('डाळ फ्राय (अर्धा)', $items['Dal Fry (Half)']['name_mr']);
        $this->assertSame('डाळ फ्राय (Full)', $items['Dal Fry (Full)']['name_mr']); // no Marathi variant name: the English one is kept
    }

    public function test_upi_id_is_saved_in_settings_and_reaches_the_bill(): void
    {
        $owner = $this->h('atithi@demo.test');
        $this->postJson('/api/company', ['upi_id' => 'not a upi'], $owner)->assertStatus(422);
        $this->postJson('/api/company', ['upi_id' => 'hotel@okbank', 'upi_name' => 'Hotel Atithi'], $owner)->assertOk()->assertJsonPath('upi_id', 'hotel@okbank');
        $cat = $this->getJson('/api/menu/categories', $owner)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Upi Tea', 'price' => 20], $owner)->assertCreated()->json();
        $bill = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [['food_item_id' => $dish['id'], 'quantity' => 1]]], $owner)->assertCreated()->json('bill');
        $this->getJson('/api/bills/'.$bill['id'], $owner)->assertOk()->assertJsonPath('company.upi_id', 'hotel@okbank')->assertJsonPath('company.upi_name', 'Hotel Atithi');
        $this->postJson('/api/company', ['upi_id' => ''], $owner)->assertOk()->assertJsonPath('upi_id', null); // cleared = no QR
    }
}

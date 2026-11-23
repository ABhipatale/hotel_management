<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** A dish with variants can name its base option ("Half") instead of "Regular"; the name follows the order line to the bill. */
class BaseVariantNameTest extends TestCase
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

    private function owner(): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    public function test_base_option_name_is_saved_ordered_billed_and_clearable(): void
    {
        $h = $this->owner();
        $cat = $this->getJson('/api/menu/categories', $h)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Dal Fry', 'name_mr' => 'डाळ फ्राय', 'price' => 60, 'base_variant_name' => 'Half', 'base_variant_name_mr' => 'अर्धा',
            'variants' => [['name' => 'Full', 'price' => 100]]], $h)->assertCreated()->json();
        $this->assertSame('Half', $dish['base_variant_name']);
        $plain = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Plain Roti', 'price' => 10], $h)->assertCreated()->json();
        $full = $dish['variants'][0]['id'];

        // the base option is stored on the order line, so KOT and bill show "(Half)"
        $o = $this->postJson('/api/orders', ['type' => 'takeaway', 'generate_bill' => true, 'items' => [
            ['food_item_id' => $dish['id'], 'quantity' => 2], ['food_item_id' => $dish['id'], 'variant_id' => $full, 'quantity' => 1], ['food_item_id' => $plain['id'], 'quantity' => 1],
        ]], $h)->assertCreated()->json();
        $lines = collect($o['items'])->keyBy(fn ($i) => $i['name'].'|'.$i['variant']);
        $this->assertSame(60.0, (float) $lines['Dal Fry|Half']['price']);
        $this->assertSame(100.0, (float) $lines['Dal Fry|Full']['price']);
        $this->assertNull($lines['Plain Roti|']['variant']); // a dish without variants is untouched

        $bill = collect($this->getJson('/api/bills/'.$o['bill']['id'], $h)->assertOk()->json('bill.items'))->keyBy('name');
        $this->assertArrayHasKey('Dal Fry (Half)', $bill->all());
        $this->assertArrayHasKey('Dal Fry (Full)', $bill->all());
        $this->assertSame('डाळ फ्राय (अर्धा)', $bill['Dal Fry (Half)']['name_mr']); // the Marathi bill uses the base option's Marathi name

        // editing the order keeps the lines (no cancel + re-add of the unchanged base line)
        $order = $this->putJson('/api/orders/'.$o['id'].'/items', ['items' => [
            ['food_item_id' => $dish['id'], 'quantity' => 3], ['food_item_id' => $dish['id'], 'variant_id' => $full, 'quantity' => 1], ['food_item_id' => $plain['id'], 'quantity' => 1],
        ]], $h)->assertOk()->json();
        $live = collect($order['items'])->where('status', '!=', 'cancelled');
        $this->assertCount(3, $live);
        $this->assertSame(3, (int) $live->firstWhere('variant', 'Half')['quantity']);

        // clearing the name goes back to "Regular" (no label) for new orders
        $up = $this->post('/api/menu/items/'.$dish['id'], ['base_variant_name' => '', 'base_variant_name_mr' => ''], $h)->assertOk()->json();
        $this->assertNull($up['base_variant_name']);
        $o2 = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $dish['id'], 'quantity' => 1]]], $h)->assertCreated()->json();
        $this->assertNull($o2['items'][0]['variant']);
    }

    public function test_base_name_is_ignored_when_the_dish_has_no_variants(): void
    {
        $h = $this->owner();
        $cat = $this->getJson('/api/menu/categories', $h)->json('0.id');
        $dish = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Solo', 'price' => 50, 'base_variant_name' => 'Half'], $h)->assertCreated()->json();
        $o = $this->postJson('/api/orders', ['type' => 'takeaway', 'items' => [['food_item_id' => $dish['id'], 'quantity' => 1]]], $h)->assertCreated()->json();
        $this->assertNull($o['items'][0]['variant']);
    }
}

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
}

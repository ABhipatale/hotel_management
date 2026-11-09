<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Product numbers: auto-assigned, unique per company, searchable. */
class ProductNumberTest extends TestCase
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
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    public function test_numbers_are_auto_assigned_unique_and_searchable(): void
    {
        $h = $this->h('atithi@demo.test');
        $cat = $this->getJson('/api/menu/categories', $h)->json('0.id');
        $max = collect($this->getJson('/api/menu/items', $h)->json())->max('code');
        $this->assertNotNull($max);

        // blank number -> next free one
        $a = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Roti', 'price' => 20], $h)->assertCreated();
        $this->assertSame($max + 1, $a->json('code'));
        $this->getJson('/api/menu/next-code', $h)->assertJsonPath('code', $max + 2);

        // chosen number is kept, a duplicate is refused
        $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Bhaji', 'price' => 40, 'code' => 500], $h)->assertCreated()->assertJsonPath('code', 500);
        $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Dup', 'price' => 10, 'code' => 500], $h)->assertStatus(422)->assertJsonValidationErrors('code');

        // editing without changing the number is fine; a blank number keeps the current one
        $id = $a->json('id');
        $this->postJson("/api/menu/items/$id", ['name' => 'Roti plain', 'code' => $a->json('code')], $h)->assertOk()->assertJsonPath('code', $max + 1);
        $this->postJson("/api/menu/items/$id", ['name' => 'Roti plain', 'code' => ''], $h)->assertOk()->assertJsonPath('code', $max + 1);

        // search by number finds it; list is ordered by number
        $found = $this->getJson('/api/menu/items?search=500', $h)->json();
        $this->assertSame('Bhaji', $found[0]['name']);
        $codes = collect($this->getJson('/api/menu/items', $h)->json())->pluck('code')->all();
        $sorted = $codes;
        sort($sorted);
        $this->assertSame($sorted, $codes);
    }

    public function test_same_number_can_exist_in_two_companies(): void
    {
        $a = $this->h('atithi@demo.test');
        $b = $this->h('friends@demo.test');
        $ca = $this->getJson('/api/menu/categories', $a)->json('0.id');
        $this->postJson('/api/menu/items', ['category_id' => $ca, 'name' => 'X', 'price' => 1, 'code' => 777], $a)->assertCreated();
        $cb = $this->getJson('/api/menu/categories', $b)->json('0.id');
        $this->postJson('/api/menu/items', ['category_id' => $cb, 'name' => 'Y', 'price' => 1, 'code' => 777], $b)->assertCreated();
    }
}

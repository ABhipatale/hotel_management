<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Owners can arrange the category sequence; it is used everywhere categories are listed. */
class CategoryOrderTest extends TestCase
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

    public function test_owner_can_move_a_category_to_the_top_and_new_ones_go_last(): void
    {
        $h = $this->h('atithi@demo.test');
        $ids = collect($this->getJson('/api/menu/categories', $h)->json())->pluck('id')->all();
        $this->assertGreaterThan(2, count($ids));

        // move the LAST category to the top
        $new = array_merge([end($ids)], array_slice($ids, 0, -1));
        $res = $this->postJson('/api/menu/categories/reorder', ['ids' => $new], $h)->assertOk();
        $this->assertSame($new, collect($res->json())->pluck('id')->all());
        $this->assertSame($new, collect($this->getJson('/api/menu/categories', $h)->json())->pluck('id')->all());

        // a category created now goes to the end
        $added = $this->postJson('/api/menu/categories', ['name' => 'Chaat'], $h)->assertCreated()->json('id');
        $this->assertSame($added, collect($this->getJson('/api/menu/categories', $h)->json())->last()['id']);
    }

    public function test_cannot_reorder_another_hotels_categories_or_without_permission(): void
    {
        $a = $this->h('atithi@demo.test');
        $b = $this->h('friends@demo.test');
        $theirs = $this->getJson('/api/menu/categories', $b)->json('0.id');
        $this->postJson('/api/menu/categories/reorder', ['ids' => [$theirs]], $a)->assertStatus(422);

        $waiter = $this->h('waiter.atithi@demo.test');
        $mine = $this->getJson('/api/menu/categories', $a)->json('0.id');
        $this->postJson('/api/menu/categories/reorder', ['ids' => [$mine]], $waiter)->assertForbidden();
    }
}

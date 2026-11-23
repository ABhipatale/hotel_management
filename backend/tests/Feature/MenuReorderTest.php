<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\TableQrToken;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/** Owners arrange the dish order (Menu > Reorder). One order for the whole menu; product numbers never change. */
class MenuReorderTest extends TestCase
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

    private function h(string $email = 'atithi@demo.test'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token')];
    }

    private function items(array $h, string $q = ''): \Illuminate\Support\Collection
    {
        return collect($this->getJson('/api/menu/items'.$q, $h)->assertOk()->json());
    }

    public function test_without_a_reorder_the_order_is_by_product_number(): void
    {
        $h = $this->h();
        $codes = $this->items($h)->pluck('code')->all();
        $sorted = $codes;
        sort($sorted);
        $this->assertSame($sorted, $codes);
        $this->assertTrue($this->items($h)->every(fn ($i) => $i['sort_order'] === 0));
    }

    public function test_reorder_on_all_and_codes_stay_the_same(): void
    {
        $h = $this->h();
        $before = $this->items($h);
        $codeOf = $before->pluck('code', 'id')->all();
        $new = $before->pluck('id')->reverse()->values()->all();

        $res = $this->postJson('/api/menu/items/reorder', ['ids' => $new], $h)->assertOk();
        $this->assertSame($new, collect($res->json())->pluck('id')->all());
        $after = $this->items($h);
        $this->assertSame($new, $after->pluck('id')->all());
        $this->assertEquals($codeOf, $after->pluck('code', 'id')->all());
    }

    public function test_reordering_one_category_leaves_other_dishes_in_their_places(): void
    {
        $h = $this->h();
        $all = $this->items($h);
        $cat = $all->groupBy('category_id')->filter(fn ($g) => $g->count() >= 2)->keys()->first();
        $mine = $all->where('category_id', $cat)->pluck('id')->values();
        $this->assertGreaterThanOrEqual(2, $mine->count());

        $this->postJson('/api/menu/items/reorder', ['ids' => $mine->reverse()->values()->all()], $h)->assertOk();

        $after = $this->items($h);
        $slots = $all->keys()->filter(fn ($i) => $all[$i]['category_id'] === $cat)->values()->all();
        foreach ($all as $i => $dish) {
            if (! in_array($i, $slots, true)) {
                $this->assertSame($dish['id'], $after[$i]['id'], 'a dish of another category moved');
            }
        }
        $this->assertSame($mine->reverse()->values()->all(), $after->where('category_id', $cat)->pluck('id')->values()->all());
        // the category filter shows the new order too
        $this->assertSame($mine->reverse()->values()->all(), $this->items($h, '?category_id='.$cat)->pluck('id')->all());
    }

    public function test_new_and_csv_dishes_go_to_the_end_after_a_reorder_but_not_before(): void
    {
        $h = $this->h();
        $cat = $this->items($h)->first()['category_id'];

        // nothing arranged yet: a new dish stays at 0 and sorts by code, as today
        $a = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Aaa First', 'price' => 10], $h)->assertCreated();
        $this->assertSame(0, $a->json('sort_order'));

        $ids = $this->items($h)->pluck('id')->reverse()->values()->all();
        $this->postJson('/api/menu/items/reorder', ['ids' => $ids], $h)->assertOk();

        $b = $this->postJson('/api/menu/items', ['category_id' => $cat, 'name' => 'Added Dish', 'price' => 10], $h)->assertCreated();
        $csv = "name,category,price\nImported Dish,Soup,50\n";
        $this->post('/api/menu/import', ['file' => UploadedFile::fake()->createWithContent('m.csv', $csv)], $h)->assertOk()->assertJsonPath('created', 1);

        $after = $this->items($h);
        $this->assertSame($b->json('id'), $after[count($after) - 2]['id']);
        $this->assertSame('Imported Dish', $after->last()['name']);
    }

    public function test_other_companys_ids_are_refused_and_a_waiter_cannot_reorder(): void
    {
        $theirs = $this->items($this->h('friends@demo.test'))->first()['id'];
        $this->postJson('/api/menu/items/reorder', ['ids' => [$theirs]], $this->h())->assertStatus(422);

        $mine = $this->items($this->h())->first()['id'];
        $this->postJson('/api/menu/items/reorder', ['ids' => [$mine]], $this->h('waiter.atithi@demo.test'))->assertForbidden();
        $this->postJson('/api/menu/items/reorder', ['ids' => []], $this->h())->assertStatus(422);
    }

    public function test_the_qr_menu_follows_the_order(): void
    {
        $h = $this->h();
        $ids = $this->items($h)->where('is_available', true)->pluck('id')->reverse()->values()->all();
        $this->postJson('/api/menu/items/reorder', ['ids' => $ids], $h)->assertOk();

        [$company, $qr] = Tenant::unscoped(function () {
            $c = Company::where('slug', 'hotel-atithi')->firstOrFail();

            return [$c, TableQrToken::where('company_id', $c->id)->firstOrFail()];
        });
        $public = collect($this->getJson("/api/public/menu/{$company->slug}/table/{$qr->token}")->assertOk()->json('items'))->pluck('id')->all();
        $expected = array_values(array_intersect($ids, $public));
        $this->assertSame($expected, $public);
    }
}

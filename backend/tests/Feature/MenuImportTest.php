<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/** Bulk menu upload from a CSV. */
class MenuImportTest extends TestCase
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
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => 'Demo@12345'])->assertOk()->json('token'), 'Accept' => 'application/json'];
    }

    private function upload(array $h, string $csv)
    {
        return $this->post('/api/menu/import', ['file' => UploadedFile::fake()->createWithContent('menu.csv', $csv)], $h);
    }

    public function test_csv_import_creates_updates_and_reports_bad_rows(): void
    {
        $h = $this->h('atithi@demo.test');
        $csv = "\xEF\xBB\xBFproduct_number,name,marathi_name,category,price,gst_percent,discount_percent,veg,available,stock,description,offer_text\n"
            ."801,Roti,चपाती,Breads,20,5,0,yes,yes,,\"Fresh, hot\",\n"
            ."802,Chicken Biryani,चिकन बिर्याणी,Rice,220,5,10,no,yes,40,,Lunch special\n"
            .",Plain Rice,,Rice,80,,,,,,,\n"
            ."803,,,Rice,10,,,,,,,\n"
            ."804,Bad Price,,Rice,abc,,,,,,,\n"
            ."801,Duplicate,,Rice,5,,,,,,,\n";

        $res = $this->upload($h, $csv)->assertOk();
        $res->assertJsonPath('created', 3)->assertJsonPath('updated', 0)->assertJsonPath('skipped', 3);
        $this->assertSame([5, 6, 7], array_column($res->json('errors'), 'row')); // file line numbers (header = line 1)

        $items = collect($this->getJson('/api/menu/items', $h)->json());
        $roti = $items->firstWhere('code', 801);
        $this->assertSame('चपाती', $roti['name_mr']);
        $this->assertSame('Fresh, hot', $roti['description']);
        $this->assertFalse($items->firstWhere('code', 802)['is_veg']);
        $this->assertSame(40, $items->firstWhere('code', 802)['stock']);
        $this->assertNotNull($items->firstWhere('name', 'Plain Rice')['code']); // auto-numbered
        $this->assertTrue(collect($this->getJson('/api/menu/categories', $h)->json())->pluck('name')->contains('Rice'));

        // semicolon file (Excel in some regions): a known product number UPDATES the dish, never duplicates it
        $this->upload($h, "name;category;price;product_number\nRoti Special;Breads;25;801\n")->assertOk()->assertJsonPath('updated', 1)->assertJsonPath('created', 0);
        $roti = collect($this->getJson('/api/menu/items', $h)->json())->firstWhere('code', 801);
        $this->assertSame('Roti Special', $roti['name']);
        $this->assertSame('चपाती', $roti['name_mr']); // blank cells keep the old value

        // no recognisable header -> refused
        $this->upload($h, "foo,bar\n1,2\n")->assertStatus(422);
    }

    public function test_import_stays_inside_the_company_and_needs_menu_permission(): void
    {
        $owner = $this->h('atithi@demo.test');
        $other = $this->h('friends@demo.test');
        $this->upload($owner, "name,category,price,product_number\nShared,Misc,10,901\n")->assertOk();
        $this->upload($other, "name,category,price,product_number\nTheirs,Misc,10,901\n")->assertOk()->assertJsonPath('created', 1); // same number, other company
        $this->assertCount(1, collect($this->getJson('/api/menu/items?search=Shared', $owner)->json()));
        $this->assertCount(0, collect($this->getJson('/api/menu/items?search=Shared', $other)->json()));

        $waiter = $this->h('waiter.atithi@demo.test');
        $this->upload($waiter, "name,category,price\nX,Misc,1\n")->assertForbidden();
    }
}

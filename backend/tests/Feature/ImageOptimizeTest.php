<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Uploaded pictures are shrunk so they load fast on slow mobile data. */
class ImageOptimizeTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
        Storage::fake('public');
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    public function test_dish_photo_is_resized_recompressed_and_gets_a_thumbnail(): void
    {
        $h = ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->json('token')];
        $cat = $this->getJson('/api/menu/categories', $h)->json('0.id');

        $big = UploadedFile::fake()->image('dish.jpg', 3000, 2000);
        $r = $this->post('/api/menu/items', ['category_id' => $cat, 'name' => 'Big Photo', 'price' => 50, 'image' => $big], $h + ['Accept' => 'application/json'])->assertCreated();

        $path = $r->json('image_path');
        $this->assertNotNull($path);
        Storage::disk('public')->assertExists($path);
        [$w, $hgt] = getimagesizefromstring(Storage::disk('public')->get($path));
        $this->assertLessThanOrEqual(900, max($w, $hgt));
        $this->assertLessThan($big->getSize(), Storage::disk('public')->size($path));

        $thumb = preg_replace('/\.(webp|jpg)$/', '-t.$1', $path);
        Storage::disk('public')->assertExists($thumb);
        [$tw, $th] = getimagesizefromstring(Storage::disk('public')->get($thumb));
        $this->assertLessThanOrEqual(360, max($tw, $th));

        // replacing the photo removes the old files
        $id = $r->json('id');
        $this->post("/api/menu/items/$id", ['image' => UploadedFile::fake()->image('n.png', 800, 800)], $h + ['Accept' => 'application/json'])->assertOk();
        Storage::disk('public')->assertMissing($path);
        Storage::disk('public')->assertMissing($thumb);
    }
}

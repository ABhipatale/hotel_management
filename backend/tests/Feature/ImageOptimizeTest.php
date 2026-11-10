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

    /** Regression: a live server returned 500 because imagescale() gave false. Odd pictures must still store, resized. */
    public function test_palette_and_transparent_pictures_are_stored_resized(): void
    {
        $svc = app(\App\Services\ImageService::class);

        $pal = imagecreate(2400, 1600); // 8-bit palette image
        imagecolorallocate($pal, 200, 80, 40);
        $tmp = tempnam(sys_get_temp_dir(), 'pal').'.png';
        imagepng($pal, $tmp);
        $path = $svc->store(new UploadedFile($tmp, 'pal.png', 'image/png', null, true), 'library');
        [$w, $h] = getimagesizefromstring(Storage::disk('public')->get($path));
        $this->assertLessThanOrEqual(900, max($w, $h));
        $this->assertTrue(Storage::disk('public')->exists($svc->thumbPath($path)));

        $rgba = imagecreatetruecolor(1500, 3000); // tall + alpha
        imagesavealpha($rgba, true);
        imagefill($rgba, 0, 0, imagecolorallocatealpha($rgba, 10, 120, 60, 60));
        $tmp2 = tempnam(sys_get_temp_dir(), 'rgba').'.png';
        imagepng($rgba, $tmp2);
        $path2 = $svc->store(new UploadedFile($tmp2, 'a.png', 'image/png', null, true), 'library');
        [$w2, $h2] = getimagesizefromstring(Storage::disk('public')->get($path2));
        $this->assertSame(900, $h2);
        $this->assertSame(450, $w2);
    }
}

<?php

namespace Tests\Feature;

use App\Models\LibraryImage;
use App\Services\ImageService;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** A dish photo is never reported as saved unless it really is, and a failed replacement never destroys the old photo. */
class ImageSafetyTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function login(string $email, string $pw): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function admin(): array
    {
        return $this->login('admin@hms.test', 'Admin@12345');
    }

    private function photo(string $name = 'x.jpg'): UploadedFile
    {
        return UploadedFile::fake()->image($name, 600, 400);
    }

    /** An image service that fails the way a struggling server does. */
    private function failing(string $on): ImageService
    {
        return new class($on) extends ImageService {
            public function __construct(private string $on) {}

            public function store(UploadedFile $file, string $dir, int $max = 900, ?int $thumb = 360): string
            {
                throw new \RuntimeException('simulated: '.$this->on);
            }
        };
    }

    private function viewable(string $path): bool
    {
        $d = Storage::disk('public');

        return $d->exists($path) && $d->size($path) > 0 && @getimagesizefromstring($d->get($path)) !== false;
    }

    public function test_a_failed_replacement_keeps_the_old_library_photo(): void
    {
        $admin = $this->admin();
        $this->postJson('/api/admin/library', ['files' => [$this->photo('paneer-tikka.jpg')]], $admin)->assertCreated();
        $row = LibraryImage::first();
        $old = $row->image_path;
        $this->assertTrue($this->viewable($old));

        $this->app->instance(ImageService::class, $this->failing('disk full'));
        $this->post('/api/admin/library/'.$row->id, ['name' => 'Paneer Tikka', 'name_mr' => 'पनीर टिक्का', 'image' => $this->photo('new.jpg')], $admin)
            ->assertStatus(500)->assertJsonPath('message', fn ($m) => str_contains($m, 'old one was kept'));

        $this->assertSame($old, $row->fresh()->image_path);   // the record still points at the old photo...
        $this->assertTrue($this->viewable($old));              // ...and that file is still there and fine
    }

    public function test_a_failed_bulk_upload_leaves_no_broken_row(): void
    {
        $this->app->instance(ImageService::class, $this->failing('no permission'));
        $this->postJson('/api/admin/library', ['files' => [$this->photo('a.jpg')]], $this->admin())->assertStatus(500);
        $this->assertSame(0, LibraryImage::count());
    }

    public function test_a_replacement_in_a_bulk_upload_removes_the_old_file_only_after_the_new_one_is_in_place(): void
    {
        $admin = $this->admin();
        $this->postJson('/api/admin/library', ['files' => [$this->photo('plain-rice.jpg')]], $admin)->assertCreated();
        $old = LibraryImage::first()->image_path;
        $this->postJson('/api/admin/library', ['files' => [$this->photo('Plain Rice.jpg')]], $admin)->assertCreated()->assertJsonPath('replaced', 1);

        $row = LibraryImage::first();
        $this->assertNotSame($old, $row->image_path);
        $this->assertTrue($this->viewable($row->image_path));
        $this->assertFalse(Storage::disk('public')->exists($old));
    }

    public function test_a_converter_that_returns_nothing_never_leaves_an_empty_picture(): void
    {
        // WebP conversion yields nothing (as on some servers): the photo is saved as JPEG instead
        $noWebp = new class extends ImageService {
            protected function encode($img, bool $webp, int $q = 78): string
            {
                return $webp ? '' : parent::encode($img, false, $q);
            }
        };
        $path = $noWebp->store($this->photo(), 'library');
        $this->assertStringEndsWith('.jpg', $path);
        $this->assertTrue($this->viewable($path));

        // nothing converts at all: the original upload is kept (still a real picture)
        $nothing = new class extends ImageService {
            protected function encode($img, bool $webp, int $q = 78): string
            {
                return '';
            }
        };
        $kept = $nothing->store($this->photo('orig.jpg'), 'library');
        $this->assertTrue($this->viewable($kept));
    }

    public function test_a_write_that_does_not_land_is_an_error_not_a_broken_picture(): void
    {
        $cannotWrite = new class extends ImageService {
            protected function write(string $path, string $bytes): void
            {
                throw new \RuntimeException('The picture could not be saved on the server (disk full or no permission).');
            }
        };
        $this->expectException(\RuntimeException::class);
        $cannotWrite->store($this->photo(), 'library');
    }

    public function test_the_check_lists_missing_and_empty_photos_but_never_flags_good_ones(): void
    {
        $admin = $this->admin();
        $this->postJson('/api/admin/library', ['files' => [$this->photo('good-dish.jpg')]], $admin)->assertCreated();
        $good = LibraryImage::first();
        $mk = fn (string $name, string $path) => LibraryImage::create(['name' => $name, 'image_path' => $path]);
        $mk('Missing Dish', 'library/nope.webp');
        Storage::disk('public')->put('library/empty.webp', '');
        $mk('Empty Dish', 'library/empty.webp');

        $r = $this->getJson('/api/admin/library/check', $admin)->assertOk();
        $this->assertSame(3, $r->json('checked'));
        $this->assertEqualsCanonicalizing(['Missing Dish' => 'missing', 'Empty Dish' => 'missing'], collect($r->json('broken'))->pluck('reason', 'name')->all());
        $this->assertNotContains($good->id, collect($r->json('broken'))->pluck('id')->all());

        $this->getJson('/api/admin/library/check', $this->login('atithi@demo.test', 'Demo@12345'))->assertForbidden(); // platform admin only
    }

    public function test_photos_saved_outside_the_website_folder_are_found_and_copied_by_repair(): void
    {
        $admin = $this->admin();
        $this->postJson('/api/admin/library', ['files' => [$this->photo('stuck-dish.jpg')]], $admin)->assertCreated();
        $img = LibraryImage::first();
        $web = sys_get_temp_dir().'/hms-web-'.uniqid();
        mkdir($web.'/storage', 0775, true);
        $_SERVER['DOCUMENT_ROOT'] = $web;
        try {
            $r = $this->getJson('/api/admin/library/check', $admin)->assertOk();
            $this->assertSame([['id' => $img->id, 'name' => $img->name, 'reason' => 'stranded']], $r->json('broken'));
            $this->assertSame(1, $r->json('stranded'));

            $fix = $this->postJson('/api/admin/library/repair', [], $admin)->assertOk();
            $this->assertGreaterThan(0, $fix->json('copied'));
            $this->assertSame([], $fix->json('broken'));
            $this->assertFileExists($web.'/storage/'.$img->image_path);
            $this->assertTrue(Storage::disk('public')->exists($img->image_path)); // nothing was removed
        } finally {
            unset($_SERVER['DOCUMENT_ROOT']);
        }
    }

    public function test_a_failed_dish_photo_replacement_keeps_the_dishs_old_photo(): void
    {
        $owner = $this->login('atithi@demo.test', 'Demo@12345');
        $dish = $this->getJson('/api/menu/items', $owner)->json('0');
        $this->post('/api/menu/items/'.$dish['id'], ['name' => $dish['name'], 'price' => $dish['price'], 'category_id' => $dish['category_id'], 'image' => $this->photo('own.jpg')], $owner)->assertSuccessful();
        $old = \App\Models\FoodItem::withoutGlobalScopes()->find($dish['id'])->image_path;
        $this->assertTrue($this->viewable($old));

        $this->app->instance(ImageService::class, $this->failing('memory'));
        $this->post('/api/menu/items/'.$dish['id'], ['name' => $dish['name'], 'price' => $dish['price'], 'category_id' => $dish['category_id'], 'image' => $this->photo('new.jpg')], $owner)->assertStatus(500);
        $this->assertSame($old, \App\Models\FoodItem::withoutGlobalScopes()->find($dish['id'])->image_path);
        $this->assertTrue($this->viewable($old));
    }
}

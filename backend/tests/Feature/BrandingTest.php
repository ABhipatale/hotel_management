<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class BrandingTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
    }

    /** The Sanctum guard memoises the user inside one test process; reset it per request. */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function h(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function company(string $name): Company
    {
        return Tenant::unscoped(fn () => Company::where('name', $name)->firstOrFail());
    }

    public function test_owner_uploads_logo_and_app_icon_and_gets_own_manifest(): void
    {
        $a = $this->h('atithi@demo.test');
        $res = $this->post('/api/company', [
            'logo' => UploadedFile::fake()->image('logo.png', 400, 200),
            'icon' => UploadedFile::fake()->image('icon.png', 600, 400), // non-square: gets centre-cropped
        ], $a + ['Accept' => 'application/json'])->assertOk();

        $res->assertJsonPath('icon_url', fn ($u) => str_contains($u, '/storage/icons/') && str_ends_with($u, '-512.png'));
        $c = $this->company('Hotel Atithi');
        Storage::disk('public')->assertExists($c->icon_path.'-192.png');
        Storage::disk('public')->assertExists($c->icon_path.'-512.png');
        $this->assertSame([512, 512], array_slice(getimagesizefromstring(Storage::disk('public')->get($c->icon_path.'-512.png')), 0, 2));
        $this->assertSame([192, 192], array_slice(getimagesizefromstring(Storage::disk('public')->get($c->icon_path.'-192.png')), 0, 2));

        $m = $this->getJson('/api/public/manifest/hotel-atithi.webmanifest')->assertOk();
        $m->assertJsonPath('name', 'Hotel Atithi')->assertJsonPath('id', '/?company=hotel-atithi')->assertJsonPath('display', 'standalone');
        $this->assertStringContainsString('manifest+json', $m->headers->get('Content-Type'));
        $this->assertStringContainsString($c->icon_path, $m->json('icons.0.src'));

        // Friends has no custom icon yet: gets its own name/id and the default icons
        $f = $this->getJson('/api/public/manifest/friends-restaurant.webmanifest')->assertOk();
        $f->assertJsonPath('name', 'Friends Restaurant')->assertJsonPath('id', '/?company=friends-restaurant');
        $this->assertStringNotContainsString('icons/', $f->json('icons.0.src'));
    }

    public function test_replacing_and_removing_icon_cleans_old_files(): void
    {
        $a = $this->h('atithi@demo.test') + ['Accept' => 'application/json'];
        $this->post('/api/company', ['icon' => UploadedFile::fake()->image('a.png', 300, 300)], $a)->assertOk();
        $old = $this->company('Hotel Atithi')->icon_path;
        $this->post('/api/company', ['icon' => UploadedFile::fake()->image('b.png', 300, 300)], $a)->assertOk();
        $new = $this->company('Hotel Atithi')->icon_path;
        $this->assertNotSame($old, $new);
        Storage::disk('public')->assertMissing($old.'-512.png');
        Storage::disk('public')->assertExists($new.'-512.png');

        $this->post('/api/company', ['remove_icon' => '1'], $a)->assertOk();
        $this->assertNull($this->company('Hotel Atithi')->icon_path);
        Storage::disk('public')->assertMissing($new.'-512.png');
    }

    public function test_icon_validation_and_waiter_cannot_change_branding(): void
    {
        $a = $this->h('atithi@demo.test') + ['Accept' => 'application/json'];
        $this->post('/api/company', ['icon' => UploadedFile::fake()->image('tiny.png', 64, 64)], $a)->assertStatus(422); // too small
        $this->post('/api/company', ['icon' => UploadedFile::fake()->create('x.pdf', 10, 'application/pdf')], $a)->assertStatus(422);

        $w = $this->h('waiter.atithi@demo.test') + ['Accept' => 'application/json'];
        $this->post('/api/company', ['icon' => UploadedFile::fake()->image('i.png', 300, 300)], $w)->assertForbidden();
    }

    public function test_icons_are_isolated_between_companies_and_super_admin_can_set_any(): void
    {
        $a = $this->h('atithi@demo.test') + ['Accept' => 'application/json'];
        $this->post('/api/company', ['icon' => UploadedFile::fake()->image('i.png', 300, 300)], $a)->assertOk();
        $this->assertNull($this->company('Friends Restaurant')->icon_path);

        $admin = $this->h('admin@hms.test', 'Admin@12345') + ['Accept' => 'application/json'];
        $fid = $this->company('Friends Restaurant')->id;
        $this->post("/api/admin/companies/$fid/branding", [
            'logo' => UploadedFile::fake()->image('l.png', 300, 300),
            'icon' => UploadedFile::fake()->image('i.png', 512, 512),
        ], $admin)->assertOk()->assertJsonPath('icon_url', fn ($u) => str_contains($u, "/icons/$fid-"));

        $this->assertNotSame($this->company('Hotel Atithi')->icon_path, $this->company('Friends Restaurant')->icon_path);
        // Owners cannot use the admin endpoint
        $this->post("/api/admin/companies/$fid/branding", ['icon' => UploadedFile::fake()->image('i.png', 300, 300)], $a)->assertForbidden();
    }

    public function test_manifest_is_unavailable_for_suspended_or_unknown_company(): void
    {
        $c = $this->company('Hotel Atithi');
        Tenant::unscoped(fn () => $c->forceFill(['status' => 'suspended'])->save());
        $this->getJson('/api/public/manifest/hotel-atithi.webmanifest')->assertNotFound();
        $this->getJson('/api/public/manifest/nope.webmanifest')->assertNotFound();
    }
}

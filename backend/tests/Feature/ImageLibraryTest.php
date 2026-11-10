<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/** Platform dish-photo library: super admin uploads, hotels see matching photos automatically. */
class ImageLibraryTest extends TestCase
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

    private function h(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function upload(array $admin, array $names)
    {
        $files = array_map(fn ($n) => UploadedFile::fake()->image($n, 600, 400), $names);

        return $this->post('/api/admin/library', ['files' => $files], $admin);
    }

    private function dish(array $h, string $name, array $extra = [])
    {
        $cat = $this->getJson('/api/menu/categories', $h)->json('0.id');

        return $this->post('/api/menu/items', array_merge(['category_id' => $cat, 'name' => $name, 'price' => 100], $extra), $h);
    }

    public function test_admin_uploads_and_hotels_get_matching_photos_automatically(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->upload($admin, ['paneer-butter-masala.jpg', 'dal_tadka.png'])->assertCreated()->assertJsonPath('created', 2);

        $owner = $this->h('atithi@demo.test');
        $items = collect($this->getJson('/api/menu/items', $owner)->json());
        // a seeded dish named "Dal Tadka" now shows the library photo
        $dal = $items->firstWhere('name', 'Dal Tadka');
        $this->assertSame('library', $dal['image_source']);
        $this->assertStringContainsString('/storage/library/', $dal['image_url']);

        // different word order + brackets still match
        $d = $this->dish($owner, 'Butter Paneer Masala (Full)')->assertCreated();
        $this->assertSame('library', $d->json('image_source'));
        // an unknown dish has no photo
        $this->assertNull($this->dish($owner, 'Mystery Curry')->json('image_url'));

        // same name again REPLACES the photo instead of duplicating it
        $this->upload($admin, ['Dal-Tadka.jpg'])->assertCreated()->assertJsonPath('replaced', 1);
        $this->assertCount(2, $this->getJson('/api/admin/library', $admin)->json());
    }

    public function test_own_photo_wins_and_owner_can_pick_hide_or_reset(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->upload($admin, ['roti.jpg', 'naan.jpg'])->assertCreated();
        $owner = $this->h('atithi@demo.test');
        $naan = collect($this->getJson('/api/library', $owner)->json())->firstWhere('name', 'Naan');

        // own upload beats the matching library photo
        $d = $this->dish($owner, 'Roti', ['image' => UploadedFile::fake()->image('mine.jpg', 500, 500)])->assertCreated();
        $this->assertSame('own', $d->json('image_source'));
        $id = $d->json('id');

        // picking a library photo replaces the own one
        $this->post("/api/menu/items/$id", ['library_image_id' => $naan['id']], $owner)->assertOk()->assertJsonPath('image_source', 'library')->assertJsonPath('library_image_id', $naan['id']);
        $this->assertNull($this->getJson('/api/menu/items?search=Roti', $owner)->json('0.image_path'));

        // "no photo" hides even the matching library photo
        $this->post("/api/menu/items/$id", ['image_action' => 'remove'], $owner)->assertOk()->assertJsonPath('image_url', null);
        // "automatic" goes back to name matching (Roti -> roti.jpg)
        $this->post("/api/menu/items/$id", ['image_action' => 'auto'], $owner)->assertOk()->assertJsonPath('image_source', 'library')->assertJsonPath('library_image_id', null);

        // an id that does not exist is refused
        $this->post("/api/menu/items/$id", ['library_image_id' => 99999], $owner)->assertStatus(422);
    }

    public function test_company_switch_and_permissions_and_delete(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->upload($admin, ['dal-tadka.jpg'])->assertCreated();
        $owner = $this->h('atithi@demo.test');
        $waiter = $this->h('waiter.atithi@demo.test');
        $company = Tenant::unscoped(fn () => Company::where('slug', 'hotel-atithi')->firstOrFail());

        // hotels cannot change the library; waiters cannot browse it
        $this->post('/api/admin/library', ['files' => [UploadedFile::fake()->image('x.jpg')]], $owner)->assertForbidden();
        $this->getJson('/api/library', $waiter)->assertForbidden();
        $this->assertCount(1, $this->getJson('/api/library', $owner)->json());

        // admin switches platform photos off for this hotel: no photos, empty picker
        $this->putJson("/api/admin/companies/{$company->id}", ['use_library_images' => false], $admin)->assertOk()->assertJsonPath('use_library_images', false);
        $this->assertNull(collect($this->getJson('/api/menu/items', $owner)->json())->firstWhere('name', 'Dal Tadka')['image_url']);
        $this->assertCount(0, $this->getJson('/api/library', $owner)->json());
        $this->putJson("/api/admin/companies/{$company->id}", ['use_library_images' => true], $admin)->assertOk();

        // deleting a library photo removes it from every dish
        $id = $this->getJson('/api/admin/library', $admin)->json('0.id');
        $this->deleteJson("/api/admin/library/$id", [], $admin)->assertNoContent();
        $this->assertNull(collect($this->getJson('/api/menu/items', $owner)->json())->firstWhere('name', 'Dal Tadka')['image_url']);

        // customers' QR menu also gets the photo
        $this->upload($admin, ['dal-tadka.jpg'])->assertCreated();
        $token = \App\Models\TableQrToken::withoutGlobalScopes()->where('company_id', $company->id)->value('token');
        $menu = $this->getJson("/api/public/menu/{$company->slug}/table/$token")->assertOk()->json('items');
        $this->assertStringContainsString('/storage/library/', collect($menu)->firstWhere('name', 'Dal Tadka')['image_url']);
    }
}

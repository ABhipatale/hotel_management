<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\TableQrToken;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** QR table ordering can be switched on/off per company by the platform admin. */
class QrToggleTest extends TestCase
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

    private function h(string $email, string $pw): array
    {
        return ['Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    public function test_qr_can_be_switched_off_and_on_per_company(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $owner = $this->h('atithi@demo.test', 'Demo@12345');
        [$company, $qr, $table] = Tenant::unscoped(function () {
            $c = Company::where('slug', 'hotel-atithi')->firstOrFail();
            $q = TableQrToken::where('company_id', $c->id)->firstOrFail();

            return [$c, $q, $q->table_id];
        });

        // on by default
        $this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertJsonPath('company.qr_enabled', true);
        $this->getJson("/api/public/menu/{$company->slug}/table/{$qr->token}")->assertOk();
        $this->getJson("/api/tables/$table/qr", $owner)->assertOk();

        // admin switches it off
        $this->putJson("/api/admin/companies/{$company->id}", ['qr_enabled' => false], $admin)->assertOk()->assertJsonPath('qr_enabled', false);
        $this->getJson("/api/public/menu/{$company->slug}/table/{$qr->token}")->assertNotFound();
        $this->postJson("/api/public/menu/{$company->slug}/table/{$qr->token}/orders", ['items' => [['food_item_id' => 1, 'quantity' => 1]]])->assertNotFound();
        $this->getJson("/api/tables/$table/qr", $owner)->assertForbidden();
        $this->postJson("/api/tables/$table/qr/regenerate", [], $owner)->assertForbidden();
        $this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertJsonPath('company.qr_enabled', false);
        $this->getJson('/api/tables', $owner)->assertOk(); // the rest of the app is unaffected

        // owners cannot switch it back on themselves
        $this->putJson('/api/company', ['qr_enabled' => true], $owner);
        $this->getJson("/api/public/menu/{$company->slug}/table/{$qr->token}")->assertNotFound();

        $this->putJson("/api/admin/companies/{$company->id}", ['qr_enabled' => true], $admin)->assertOk();
        $this->getJson("/api/public/menu/{$company->slug}/table/{$qr->token}")->assertOk();
    }

    public function test_new_company_can_be_created_with_qr_off(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->postJson('/api/admin/companies', [
            'company_name' => 'No Qr Cafe', 'owner_name' => 'N', 'phone' => '9', 'email' => 'noqr@test.dev', 'password' => 'Secret123',
            'billing_cycle' => 'monthly', 'qr_enabled' => false,
        ], $admin)->assertCreated()->assertJsonPath('qr_enabled', false);
        $this->postJson('/api/auth/login', ['email' => 'noqr@test.dev', 'password' => 'Secret123'])->assertJsonPath('company.qr_enabled', false);
    }
}

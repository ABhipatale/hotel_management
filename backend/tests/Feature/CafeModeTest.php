<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Business type: every company is a 'restaurant' (the app exactly as it always worked) unless the platform admin makes it a 'cafe'. */
class CafeModeTest extends TestCase
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

    private function login(string $email, string $pw = 'Demo@12345'): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    public function test_existing_companies_stay_restaurant(): void
    {
        $owner = $this->login('atithi@demo.test');
        $this->assertSame('restaurant', $this->getJson('/api/auth/me', $owner)->json('company.business_type'));
    }

    public function test_admin_can_create_and_switch_a_cafe_and_it_still_bills_in_one_step(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $this->postJson('/api/admin/companies', ['company_name' => 'Brew Cafe', 'owner_name' => 'Ravi', 'phone' => '9000000001', 'email' => 'brew@demo.test', 'password' => '123456', 'billing_cycle' => 'monthly', 'business_type' => 'cafe'], $admin)->assertCreated();
        $owner = $this->login('brew@demo.test', '123456');
        $this->assertSame('cafe', $this->getJson('/api/auth/me', $owner)->json('company.business_type'));

        $id = Company::where('email', 'brew@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['business_type' => 'restaurant'], $admin)->assertOk();
        $this->assertSame('restaurant', $this->getJson('/api/auth/me', $owner)->json('company.business_type'));
        $this->putJson("/api/admin/companies/$id", ['business_type' => 'bar'], $admin)->assertStatus(422);
    }
}

<?php

namespace Tests\Feature;

use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Passwords may be as short as 6 characters (a 6-digit PIN). */
class ShortPasswordTest extends TestCase
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

    public function test_staff_can_have_a_six_digit_pin(): void
    {
        $owner = $this->h('atithi@demo.test', 'Demo@12345');
        $this->postJson('/api/staff', ['name' => 'Ravi', 'email' => 'ravi@atithi.test', 'password' => '12345', 'role' => 'waiter'], $owner)->assertStatus(422)->assertJsonValidationErrors('password');
        $id = $this->postJson('/api/staff', ['name' => 'Ravi', 'email' => 'ravi@atithi.test', 'password' => '123456', 'role' => 'waiter'], $owner)->assertCreated()->json('id');
        $this->h('ravi@atithi.test', '123456'); // can sign in with the 6-digit PIN

        $this->putJson("/api/staff/$id", ['password' => '654321'], $owner)->assertOk();
        $this->h('ravi@atithi.test', '654321');
        $this->putJson("/api/staff/$id", ['password' => '1234'], $owner)->assertStatus(422);
    }

    public function test_new_company_owner_can_have_a_six_digit_pin(): void
    {
        $admin = $this->h('admin@hms.test', 'Admin@12345');
        $this->postJson('/api/admin/companies', ['company_name' => 'Pin Cafe', 'owner_name' => 'P', 'phone' => '9000000009', 'email' => 'pin@cafe.test', 'password' => '112233', 'city' => 'Pune'], $admin)->assertCreated();
        $this->h('pin@cafe.test', '112233');
    }
}

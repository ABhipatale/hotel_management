<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Things that must be true on the live server. */
class ProductionSafetyTest extends TestCase
{
    use RefreshDatabase;

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }

    private function seedAsProduction(?string $email = null, ?string $password = null): void
    {
        $this->app->detectEnvironment(fn () => 'production');
        config(['hms.admin.email' => $email, 'hms.admin.password' => $password]);
        $this->artisan('db:seed', ['--class' => DatabaseSeeder::class, '--force' => true]); // as on the server: production asks for --force
        Tenant::clear();
    }

    private function admins(): array
    {
        return Tenant::unscoped(fn () => User::where('role', 'super_admin')->pluck('email')->all());
    }

    public function test_production_never_creates_the_published_admin_password(): void
    {
        $this->seedAsProduction();                       // nothing configured: no admin at all
        $this->assertSame([], $this->admins());
        $this->assertSame(0, User::withoutGlobalScopes()->where('email', 'like', '%@demo.test')->count()); // and no demo hotels either
    }

    public function test_production_admin_needs_a_strong_password_from_the_environment(): void
    {
        $this->seedAsProduction('owner@my-company.in', 'short');                // too short: refused
        $this->assertSame([], $this->admins());

        $this->seedAsProduction('owner@my-company.in', 'a-long-strong-pass-9'); // 12+ characters: created
        $this->assertSame(['owner@my-company.in'], $this->admins());
        $this->postJson('/api/auth/login', ['email' => 'admin@hms.test', 'password' => 'Admin@12345'])->assertStatus(422);   // the published login does not exist
        $this->postJson('/api/auth/login', ['email' => 'owner@my-company.in', 'password' => 'a-long-strong-pass-9'])->assertOk();
    }

    public function test_the_request_limit_is_per_device_not_per_login(): void
    {
        $this->seed(DatabaseSeeder::class);
        Tenant::clear();
        $login = fn () => ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertOk()->json('token')];
        $tabletA = $login();
        $tabletB = $login();                              // the same person signed in on a second tablet

        foreach (range(1, 240) as $i) {
            $this->getJson('/api/auth/me', $tabletA)->assertOk();
        }
        $this->getJson('/api/auth/me', $tabletA)->assertStatus(429);   // tablet A used up ITS share
        $this->getJson('/api/auth/me', $tabletB)->assertOk();          // tablet B is not affected
    }
}

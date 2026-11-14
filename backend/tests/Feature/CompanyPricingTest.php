<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Models\SubscriptionPayment;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Subscription price per company: its own price if the platform admin set one, otherwise the default (₹500 / ₹5500). */
class CompanyPricingTest extends TestCase
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

    public function test_default_price_is_500_monthly_and_5500_yearly_for_everyone(): void
    {
        $this->getJson('/api/subscription/pricing', $this->login('atithi@demo.test'))->assertOk()->assertJsonPath('price_monthly', 500)->assertJsonPath('price_yearly', 5500);
        $this->getJson('/api/subscription/pricing', $this->login('friends@demo.test'))->assertOk()->assertJsonPath('price_monthly', 500)->assertJsonPath('price_yearly', 5500);
    }

    public function test_a_company_can_have_its_own_price_without_touching_other_companies(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $atithi = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$atithi", ['price_monthly' => 750, 'price_yearly' => 8000], $admin)->assertOk();

        $a = $this->login('atithi@demo.test');
        $f = $this->login('friends@demo.test');
        $this->getJson('/api/subscription/pricing', $a)->assertJsonPath('price_monthly', 750)->assertJsonPath('price_yearly', 8000);
        $this->getJson('/api/subscription/pricing', $f)->assertJsonPath('price_monthly', 500)->assertJsonPath('price_yearly', 5500); // others keep the default

        // checkout is priced from the server, using THIS company's price
        $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'yearly'], $a)->assertOk()->assertJsonPath('amount', 8000);
        $this->postJson('/api/subscription/checkout', ['billing_cycle' => 'monthly'], $f)->assertOk()->assertJsonPath('amount', 500);
        $this->assertEquals([8000.0, 500.0], SubscriptionPayment::orderBy('id')->pluck('amount')->map(fn ($v) => (float) $v)->all());
    }

    public function test_only_one_price_can_be_custom_and_emptying_it_restores_the_default(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['price_monthly' => 300], $admin)->assertOk();
        $a = $this->login('atithi@demo.test');
        $this->getJson('/api/subscription/pricing', $a)->assertJsonPath('price_monthly', 300)->assertJsonPath('price_yearly', 5500);

        $this->putJson("/api/admin/companies/$id", ['price_monthly' => null, 'price_yearly' => ''], $admin)->assertOk();
        $this->getJson('/api/subscription/pricing', $a)->assertJsonPath('price_monthly', 500)->assertJsonPath('price_yearly', 5500);

        $this->putJson("/api/admin/companies/$id", ['price_monthly' => -1], $admin)->assertStatus(422);
        $this->putJson("/api/admin/companies/$id", ['price_monthly' => 100], $a)->assertForbidden(); // only the platform admin
    }

    public function test_renewal_by_admin_records_the_companys_price_and_default_price_changes_apply_to_non_custom_companies(): void
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Company::where('email', 'atithi@demo.test')->value('id');
        $this->putJson("/api/admin/companies/$id", ['price_monthly' => 420], $admin)->assertOk();
        $this->postJson("/api/admin/companies/$id/subscription", ['billing_cycle' => 'monthly'], $admin)->assertSuccessful();
        $this->assertEquals(420.0, (float) SubscriptionPayment::where('company_id', $id)->latest('id')->value('amount'));

        $this->putJson('/api/admin/pricing', ['price_monthly' => 600, 'price_yearly' => 6000], $admin)->assertOk();
        $this->getJson('/api/subscription/pricing', $this->login('friends@demo.test'))->assertJsonPath('price_monthly', 600);   // default changed
        $this->getJson('/api/subscription/pricing', $this->login('atithi@demo.test'))->assertJsonPath('price_monthly', 420);   // custom stays
        $this->getJson('/api/admin/dashboard', $admin)->assertOk()->assertJsonStructure(['mrr']);
    }
}

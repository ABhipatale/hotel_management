<?php

namespace Tests\Feature;

use App\Models\Company;
use App\Support\BizTime;
use App\Support\Tenant;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** Staff salary & advances: fixed monthly salary, advances (uchal), money handed back, and the monthly salary with its deductions. */
class PayrollTest extends TestCase
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

    private function login(string $email, string $pw): array
    {
        return ['Accept' => 'application/json', 'Authorization' => 'Bearer '.$this->postJson('/api/auth/login', ['email' => $email, 'password' => $pw])->assertOk()->json('token')];
    }

    private function owner(bool $on = true): array
    {
        $admin = $this->login('admin@hms.test', 'Admin@12345');
        $id = Tenant::unscoped(fn () => Company::where('slug', 'hotel-atithi')->value('id'));
        $this->putJson("/api/admin/companies/$id", ['payroll_enabled' => $on], $admin)->assertOk()->assertJsonPath('payroll_enabled', $on);

        return $this->login('atithi@demo.test', 'Demo@12345');
    }

    public function test_it_is_off_until_the_platform_admin_switches_it_on(): void
    {
        $owner = $this->login('atithi@demo.test', 'Demo@12345');
        $this->postJson('/api/auth/login', ['email' => 'atithi@demo.test', 'password' => 'Demo@12345'])->assertJsonPath('company.payroll_enabled', false);
        $this->getJson('/api/payroll/employees', $owner)->assertForbidden();
        $owner = $this->owner();
        $this->getJson('/api/payroll/employees', $owner)->assertOk()->assertJsonPath('totals.monthly_salary', 0);
    }

    public function test_advance_absent_days_and_recovery_are_worked_out_and_salary_goes_to_expenses(): void
    {
        $owner = $this->owner();
        $month = BizTime::now()->format('Y-m');
        $days = (int) \Carbon\Carbon::createFromFormat('Y-m-d', $month.'-01')->daysInMonth;
        $id = $this->postJson('/api/payroll/employees', ['name' => 'Ramesh', 'job' => 'Cook', 'monthly_salary' => 15000], $owner)->assertCreated()->json('id');

        // advance 5000, he hands back 1000 -> still owes 4000
        $this->postJson("/api/payroll/employees/$id/advance", ['amount' => 5000, 'note' => 'Diwali'], $owner)->assertCreated()->assertJsonPath('balance', 5000);
        $this->postJson("/api/payroll/employees/$id/repayment", ['amount' => 1000], $owner)->assertCreated()->assertJsonPath('balance', 4000);
        $this->postJson("/api/payroll/employees/$id/repayment", ['amount' => 9999], $owner)->assertStatus(422);

        $this->getJson('/api/payroll/employees?month='.$month, $owner)->assertOk()
            ->assertJsonPath('totals.advance_balance', 4000)->assertJsonPath('totals.pending', 15000)->assertJsonPath('employees.0.balance', 4000);

        // salary: 2 days absent, 500 bonus, 3000 of the advance deducted
        $cut = round(15000 / $days * 2, 2);
        $gross = round(15000 - $cut + 500, 2);
        $this->postJson("/api/payroll/employees/$id/salary", ['month' => $month, 'absent_days' => 2, 'bonus' => 500, 'recovery' => 5000], $owner)->assertStatus(422); // more than the 4000 owed
        $pay = $this->postJson("/api/payroll/employees/$id/salary", ['month' => $month, 'absent_days' => 2, 'bonus' => 500, 'recovery' => 3000], $owner)->assertCreated()->json();
        $this->assertEquals(round($gross - 3000, 2), $pay['amount']);
        $this->assertEquals($cut, $pay['absent_deduction']);
        $this->assertEquals(1000, $pay['balance']);
        $this->postJson("/api/payroll/employees/$id/salary", ['month' => $month], $owner)->assertStatus(422); // once a month

        // the salary cost is an expense; the advance is not
        $exp = collect($this->getJson('/api/expenses?from='.$month.'-01&to=2999-01-01', $owner)->json())->firstWhere('category', 'Salaries');
        $this->assertEquals($gross, (float) $exp['amount']);
        $tot = $this->getJson('/api/payroll/employees?month='.$month, $owner)->json('totals');
        $this->assertEquals(0, $tot['pending']);
        $this->assertEquals(round($gross - 3000, 2), $tot['paid']);

        // undo the salary: expense gone, advance owed again
        $salaryId = collect($this->getJson("/api/payroll/employees/$id", $owner)->json('entries'))->firstWhere('type', 'salary')['id'];
        $this->deleteJson("/api/payroll/entries/$salaryId", [], $owner)->assertNoContent();
        $this->assertNull(collect($this->getJson('/api/expenses?from='.$month.'-01&to=2999-01-01', $owner)->json())->firstWhere('category', 'Salaries'));
        $this->assertEquals(4000, $this->getJson("/api/payroll/employees/$id", $owner)->json('balance'));
    }

    public function test_future_month_is_refused_and_a_person_with_history_is_only_switched_off(): void
    {
        $owner = $this->owner();
        $id = $this->postJson('/api/payroll/employees', ['name' => 'Sita', 'monthly_salary' => 9000], $owner)->json('id');
        $this->postJson("/api/payroll/employees/$id/salary", ['month' => '2999-01'], $owner)->assertStatus(422);
        $this->postJson("/api/payroll/employees/$id/advance", ['amount' => 500], $owner)->assertCreated();
        $this->deleteJson("/api/payroll/employees/$id", [], $owner)->assertOk()->assertJsonPath('deactivated', true);
        $this->postJson("/api/payroll/employees/$id/salary", ['month' => BizTime::now()->format('Y-m')], $owner)->assertStatus(422); // switched off
    }
}

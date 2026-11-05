<?php

namespace Database\Seeders;

use App\Models\FoodCategory;
use App\Models\FoodItem;
use App\Models\FoodItemVariant;
use App\Models\HotelTable;
use App\Models\Branch;
use App\Models\Permission;
use App\Models\SubscriptionPlan;
use App\Models\TableQrToken;
use App\Models\User;
use App\Services\CompanyProvisioner;
use App\Services\SubscriptionService;
use App\Support\Tenant;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        foreach (config('hms.permissions') as $slug => $label) {
            Permission::updateOrCreate(['slug' => $slug], ['label' => $label]);
        }

        // One subscription for everybody. Prices are only set on first install; the admin edits them later.
        $premium = SubscriptionPlan::firstOrNew(['slug' => 'premium']);
        if (! $premium->exists) {
            $premium->forceFill(['name' => 'Subscription', 'price_monthly' => 3499, 'price_yearly' => 34990]);
        }
        $premium->forceFill(['max_staff' => null, 'max_tables' => null, 'max_branches' => 1, 'features' => config('hms.features'), 'is_active' => true])->save();

        // Single-plan product: Premium is the only plan offered.
        SubscriptionPlan::where('slug', '!=', 'premium')->update(['is_active' => false]);

        Tenant::unscoped(function () {
            User::firstOrCreate(['email' => 'admin@hms.test'], [
                'name' => 'Platform Admin', 'password' => 'Admin@12345',
            ])->forceFill(['role' => 'super_admin', 'company_id' => null])->save();
        });

        if (! app()->environment('production')) {
            $this->demo($premium);
        }
    }

    private function demo(SubscriptionPlan $premium): void
    {
        $prov = app(CompanyProvisioner::class);

        $companies = [
            ['Hotel Atithi', 'atithi@demo.test', $premium, [['Paneer Butter Masala', 240], ['Dal Tadka', 180], ['Butter Naan', 45]]],
            ['Friends Restaurant', 'friends@demo.test', $premium, [['Chicken Biryani', 280], ['Veg Fried Rice', 160], ['Cold Coffee', 90]]],
        ];

        foreach ($companies as [$name, $email, $plan, $dishes]) {
            if (\App\Models\Company::where('name', $name)->exists()) {
                continue;
            }
            [$company, $owner] = $prov->provision([
                'company_name' => $name, 'owner_name' => $name.' Owner', 'email' => $email, 'password' => 'Demo@12345',
                'phone' => '9999900000', 'address' => 'Main Road', 'city' => 'Karad', 'state' => 'Maharashtra', 'pin_code' => '415110', 'gst_number' => '27ABCDE1234F1Z5',
            ], null, $plan);

            Tenant::as($company, function () use ($company, $dishes, $email) {
                $branch = Branch::where('is_default', true)->first();
                // Same table numbers in every company — proves per-tenant uniqueness.
                foreach (['01', '02', '03'] as $n) {
                    $t = HotelTable::create(['branch_id' => $branch->id, 'number' => $n, 'capacity' => 4]);
                    TableQrToken::create(['table_id' => $t->id, 'token' => Str::random(40)]);
                }
                $cat = FoodCategory::orderBy('id')->skip(1)->first();
                foreach ($dishes as [$dish, $price]) {
                    FoodItem::create(['category_id' => $cat->id, 'name' => $dish, 'price' => $price, 'gst_percent' => 5]);
                }
                foreach (['waiter' => 'Waiter'] as $role => $label) {
                    $u = new User(['name' => "$company->name $label", 'email' => "$role.".$email, 'password' => 'Demo@12345']);
                    $u->forceFill(['company_id' => $company->id, 'role' => $role, 'role_id' => \App\Models\Role::where('slug', $role)->value('id'), 'branch_id' => $branch->id])->save();
                }
            });
        }
    }
}

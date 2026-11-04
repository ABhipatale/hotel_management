<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Company;
use App\Models\FoodCategory;
use App\Models\Permission;
use App\Models\PrinterSetting;
use App\Models\Role;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Support\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CompanyProvisioner
{
    public function __construct(private SubscriptionService $subs)
    {
    }

    /** Creates tenant + owner + defaults atomically. Returns [company, owner]. */
    public function provision(array $data, ?string $logoPath = null, ?SubscriptionPlan $plan = null): array
    {
        return DB::transaction(function () use ($data, $logoPath, $plan) {
            $plan ??= SubscriptionPlan::where('is_active', true)->orderBy('price_monthly')->firstOrFail();

            $company = (new Company())->forceFill([
                'uid' => 'CMP-'.strtoupper(Str::random(8)),
                'status' => 'trial',
                'name' => $data['company_name'],
                'business_name' => $data['business_name'] ?? $data['company_name'],
                'slug' => $this->uniqueSlug($data['company_name']),
                'logo_path' => $logoPath,
                'address' => $data['address'] ?? null,
                'city' => $data['city'] ?? null,
                'state' => $data['state'] ?? null,
                'pin_code' => $data['pin_code'] ?? null,
                'phone' => $data['phone'] ?? null,
                'email' => $data['email'],
                'gst_number' => $data['gst_number'] ?? null,
                'bill_footer' => 'Thank you! Visit again.',
                'settings' => ['currency' => 'INR', 'expiry_grace_days' => 0],
            ]);
            $company->save();

            $owner = Tenant::as($company, function () use ($company, $data) {
                $roles = $this->seedRoles();

                $branch = Branch::create(['name' => 'Main Branch', 'address' => $data['address'] ?? null, 'is_default' => true]);

                foreach (config('hms.default_categories') as $i => $name) {
                    FoodCategory::create(['name' => $name, 'sort_order' => $i]);
                }
                PrinterSetting::create([]);

                $owner = new User([
                    'name' => $data['owner_name'],
                    'email' => $data['email'],
                    'phone' => $data['phone'] ?? null,
                    'password' => $data['password'],
                ]);
                $owner->forceFill([
                    'company_id' => $company->id,
                    'role' => 'owner',
                    'role_id' => $roles['owner']->id,
                    'branch_id' => null,
                ])->save();

                return $owner;
            });

            $this->subs->startTrial($company, $plan);

            return [$company->refresh(), $owner];
        });
    }

    /** Per-company roles with default permission sets (owner-editable later). */
    public function seedRoles(): array
    {
        $perms = Permission::pluck('id', 'slug');
        $out = [];
        foreach (config('hms.role_defaults') as $slug => $slugs) {
            $role = Role::create(['name' => Str::headline($slug), 'slug' => $slug]);
            $ids = in_array('*', $slugs, true) ? $perms->values() : collect($slugs)->map(fn ($s) => $perms[$s] ?? null)->filter()->values();
            $role->permissions()->sync($ids);
            $out[$slug] = $role;
        }

        return $out;
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'company';
        $slug = $base;
        $i = 2;
        while (Company::withTrashed()->where('slug', $slug)->exists()) {
            $slug = $base.'-'.$i++;
        }

        return $slug;
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\Cache;
use Laravel\Sanctum\HasApiTokens;

/**
 * Deliberately NOT using BelongsToCompany: Sanctum / login must resolve users before a tenant
 * is known. Tenant-facing code queries users through User::inTenant().
 */
class User extends Authenticatable
{
    use HasApiTokens, HasFactory, Notifiable;

    protected $guarded = ['id', 'company_id', 'role'];
    protected $hidden = ['password', 'remember_token'];

    protected function casts(): array
    {
        return ['password' => 'hashed', 'is_active' => 'boolean', 'last_login_at' => 'datetime'];
    }

    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    public function roleModel()
    {
        return $this->belongsTo(Role::class, 'role_id');
    }

    /**
     * Counters a staff member or chef works on, the MAIN counter (users.branch_id) first: the Staff screen and setCounters()
     * treat the first one as the main counter. Plain table reads: no tenant / counter scopes involved.
     * `branch_user` has no `id` column (PK user_id + branch_id): never order it by id. MySQL refuses that; SQLite silently
     * accepts it, so the tests would not notice (error B21).
     */
    public function counterIds(): array
    {
        $ids = \Illuminate\Support\Facades\DB::table('branch_user')->where('user_id', $this->id)->orderBy('branch_id')->pluck('branch_id')->map(fn ($i) => (int) $i)->all();
        if (! $ids) {
            return $this->branch_id ? [(int) $this->branch_id] : [];
        }
        $main = (int) $this->branch_id;

        return in_array($main, $ids, true) ? array_values(array_unique([$main, ...$ids])) : $ids;
    }

    public function setCounters(array $ids): void
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        \Illuminate\Support\Facades\DB::table('branch_user')->where('user_id', $this->id)->delete();
        foreach ($ids as $b) {
            \Illuminate\Support\Facades\DB::table('branch_user')->insert(['user_id' => $this->id, 'branch_id' => $b]);
        }
        $this->forceFill(['branch_id' => $ids[0] ?? null])->save();
    }

    public function scopeInTenant($q, int $companyId)
    {
        return $q->where('company_id', $companyId);
    }

    public function isSuperAdmin(): bool
    {
        return $this->role === 'super_admin' && $this->company_id === null;
    }

    /** @return string[] permission slugs, cached per user for a few minutes */
    public function permissionSlugs(): array
    {
        if ($this->role === 'owner') {
            return ['*'];
        }

        return Cache::remember("user-perms:{$this->id}:{$this->role_id}", 300, function () {
            return $this->roleModel
                ? $this->roleModel->permissions()->pluck('slug')->all()
                : (config("hms.role_defaults.{$this->role}") ?? []);
        });
    }

    public function hasPermission(string $slug): bool
    {
        $perms = $this->permissionSlugs();

        return in_array('*', $perms, true) || in_array($slug, $perms, true);
    }
}

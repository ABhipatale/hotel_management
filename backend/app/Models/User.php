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

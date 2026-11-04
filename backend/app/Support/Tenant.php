<?php

namespace App\Support;

use App\Models\Branch;
use App\Models\Company;
use App\Models\User;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\Rule;

/**
 * Request-scoped tenant context. Always resolved server-side
 * (from the authenticated user or a verified QR token) — never from client input.
 * Fails closed: with no tenant set and no explicit bypass, tenant models return nothing.
 */
class Tenant
{
    private static ?int $id = null;
    private static ?Company $company = null;
    private static bool $unscoped = false;

    public static function set(Company $company): void
    {
        self::$company = $company;
        self::$id = $company->id;
    }

    public static function clear(): void
    {
        self::$company = null;
        self::$id = null;
        self::$unscoped = false;
    }

    public static function id(): ?int
    {
        return self::$id;
    }

    public static function company(): ?Company
    {
        return self::$company;
    }

    public static function isUnscoped(): bool
    {
        return self::$unscoped;
    }

    /** Explicit, auditable bypass (super admin, seeders, migrations). */
    public static function unscoped(callable $fn): mixed
    {
        $prev = self::$unscoped;
        self::$unscoped = true;
        try {
            return $fn();
        } finally {
            self::$unscoped = $prev;
        }
    }

    /** Run a callback as a given company (used by seeders / jobs). */
    public static function as(Company $company, callable $fn): mixed
    {
        $prevId = self::$id;
        $prevCompany = self::$company;
        $prevUnscoped = self::$unscoped;
        self::set($company);
        self::$unscoped = false;
        try {
            return $fn();
        } finally {
            self::$id = $prevId;
            self::$company = $prevCompany;
            self::$unscoped = $prevUnscoped;
        }
    }

    /**
     * Resolve the branch for this request. Branch-locked staff always use their own branch;
     * owners may pick one via ?branch_id= / X-Branch-Id, validated against the tenant.
     */
    public static function branchId(User $user, ?int $requested = null): int
    {
        if ($user->branch_id && ! in_array($user->role, ['owner'], true)) {
            return $user->branch_id;
        }
        if ($requested) {
            $ok = Branch::whereKey($requested)->where('is_active', true)->exists(); // scoped to tenant
            abort_unless($ok, 422, 'Invalid branch.');
            return $requested;
        }

        return $user->branch_id ?: (int) Branch::orderByDesc('is_default')->orderBy('id')->value('id');
    }

    /** Validation helper: foreign id must belong to the current tenant. */
    public static function exists(string $table, string $column = 'id'): Exists
    {
        return Rule::exists($table, $column)->where('company_id', self::$id);
    }
}

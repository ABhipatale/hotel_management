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
    private static ?int $branchLock = null;

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
        self::$branchLock = null;
    }

    /** Counter users of a multi-counter company are pinned to their counter (see BelongsToBranch). */
    public static function lockBranch(?int $branchId): void
    {
        self::$branchLock = $branchId;
    }

    public static function branchLock(): ?int
    {
        return self::$branchLock;
    }

    public static function multiCounter(): bool
    {
        return (bool) self::$company?->multi_counter;
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
     * Branch = "counter". Single-counter companies have exactly one default branch (unchanged behaviour).
     * Multi-counter companies: counter users use their own counter; the owner works in the counter chosen in the app
     * (X-Counter-Id header, verified against this tenant's active counters), otherwise the default one.
     */
    public static function branchId(User $user, mixed $requested = null): int
    {
        if ($user->branch_id) {
            return (int) $user->branch_id;
        }
        if (self::multiCounter() && $user->role === 'owner' && is_numeric($requested)) {
            $id = Branch::where('is_active', true)->whereKey((int) $requested)->value('id');
            if ($id) {
                return (int) $id;
            }
        }

        return (int) Branch::orderByDesc('is_default')->orderBy('id')->value('id');
    }

    /**
     * Which counter a LIST (orders, bills, dashboard, reports) covers: null = every counter (owner, "All counters").
     * Single-counter companies keep the old behaviour (their one branch).
     */
    public static function branchScope(User $user, mixed $requested = null): ?int
    {
        if (! self::multiCounter()) {
            return self::branchId($user);
        }
        if ($user->role !== 'owner') {
            return self::branchId($user);
        }

        return is_numeric($requested) ? self::branchId($user, $requested) : null;
    }

    /** Validation helper: foreign id must belong to the current tenant. */
    public static function exists(string $table, string $column = 'id'): Exists
    {
        return Rule::exists($table, $column)->where('company_id', self::$id);
    }
}

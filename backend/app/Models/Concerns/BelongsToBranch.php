<?php

namespace App\Models\Concerns;

use App\Support\Tenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Counter isolation. When the signed-in user is a counter user of a multi-counter company
 * (ResolveTenant calls Tenant::lockBranch), every query on the model is narrowed to that counter,
 * so ids from another counter simply do not exist for them. Owners / single-counter companies are never locked.
 */
trait BelongsToBranch
{
    public static function bootBelongsToBranch(): void
    {
        static::addGlobalScope('branch', function (Builder $q) {
            if (Tenant::branchLock() !== null && ! Tenant::isUnscoped()) {
                $q->where($q->getModel()->getTable().'.branch_id', Tenant::branchLock());
            }
        });

        static::creating(function (Model $m) {
            if (Tenant::branchLock() !== null && (int) $m->branch_id !== Tenant::branchLock()) {
                throw new \LogicException('This counter cannot write to another counter.');
            }
        });
    }
}

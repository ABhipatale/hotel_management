<?php

namespace App\Models\Concerns;

use App\Models\Company;
use App\Support\Tenant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Adds a fail-closed global scope on company_id and stamps company_id on create.
 * The company_id is ALWAYS taken from the server-side tenant context, never from input.
 */
trait BelongsToCompany
{
    public static function bootBelongsToCompany(): void
    {
        static::addGlobalScope('company', function (Builder $q) {
            if (Tenant::isUnscoped()) {
                return;
            }
            $table = $q->getModel()->getTable();
            if (Tenant::id() === null) {
                $q->whereRaw('1 = 0');
            } else {
                $q->where("$table.company_id", Tenant::id());
            }
        });

        static::creating(function (Model $m) {
            if (Tenant::id() !== null) {
                $m->company_id = Tenant::id();
            } elseif (! Tenant::isUnscoped() || $m->company_id === null) {
                throw new \LogicException('Cannot create tenant record without tenant context.');
            }
        });

        static::updating(function (Model $m) {
            if ($m->isDirty('company_id')) {
                throw new \LogicException('company_id is immutable.');
            }
        });
    }

    public function company()
    {
        return $this->belongsTo(Company::class);
    }
}

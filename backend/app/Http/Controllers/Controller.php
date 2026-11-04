<?php

namespace App\Http\Controllers;

use App\Support\Tenant;
use Illuminate\Http\Request;

abstract class Controller
{
    /** Branch for this request, validated against the tenant (see Tenant::branchId). */
    protected function branch(Request $request): int
    {
        $requested = $request->header('X-Branch-Id') ?: $request->query('branch_id');

        return Tenant::branchId($request->user(), $requested ? (int) $requested : null);
    }
}

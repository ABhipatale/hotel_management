<?php

namespace App\Http\Controllers;

use App\Support\Tenant;
use Illuminate\Http\Request;

abstract class Controller
{
    /** Branch = counter. One default branch per company unless the platform admin enabled multiple counters. */
    protected function branch(Request $request): int
    {
        return Tenant::branchId($request->user(), $request->header('X-Counter-Id'));
    }

    /** Counter filter for lists / reports: null = all counters (owner of a multi-counter company). */
    protected function branchScope(Request $request): ?int
    {
        return Tenant::branchScope($request->user(), $request->header('X-Counter-Id'));
    }
}

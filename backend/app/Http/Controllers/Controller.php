<?php

namespace App\Http\Controllers;

use App\Support\Tenant;
use Illuminate\Http\Request;

abstract class Controller
{
    /** Branch is internal plumbing only: each company has exactly one default branch. */
    protected function branch(Request $request): int
    {
        return Tenant::branchId($request->user());
    }
}

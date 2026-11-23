<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class EmployeeEntry extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];
    protected $casts = ['amount' => 'float', 'base_salary' => 'float', 'absent_days' => 'float', 'absent_deduction' => 'float', 'bonus' => 'float', 'recovery' => 'float'];
}

<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Expense extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $table = 'expenses';
    protected $guarded = ['id', 'company_id'];
}

<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $table = 'payments';
    protected $guarded = ['id', 'company_id'];
}

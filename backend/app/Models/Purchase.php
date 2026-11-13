<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Purchase extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $table = 'purchases';
    protected $guarded = ['id', 'company_id'];
}

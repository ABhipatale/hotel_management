<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Branch extends Model
{
    use BelongsToCompany;

    protected $table = 'branches';
    protected $guarded = ['id', 'company_id'];
}

<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Payment extends Model
{
    use BelongsToCompany;

    protected $table = 'payments';
    protected $guarded = ['id', 'company_id'];
}

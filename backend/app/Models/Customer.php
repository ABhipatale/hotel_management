<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Customer extends Model
{
    use BelongsToCompany;

    protected $table = 'customers';
    protected $guarded = ['id', 'company_id'];
}

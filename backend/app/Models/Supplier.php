<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Supplier extends Model
{
    use BelongsToCompany;

    protected $table = 'suppliers';
    protected $guarded = ['id', 'company_id'];
}

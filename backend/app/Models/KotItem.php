<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class KotItem extends Model
{
    use BelongsToCompany;

    protected $table = 'kot_items';
    protected $guarded = ['id', 'company_id'];
}

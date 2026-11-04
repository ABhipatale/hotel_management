<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class FoodItemVariant extends Model
{
    use BelongsToCompany;

    protected $table = 'food_item_variants';
    protected $guarded = ['id', 'company_id'];
}

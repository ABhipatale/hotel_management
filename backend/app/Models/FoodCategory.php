<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class FoodCategory extends Model
{
    use BelongsToCompany;

    protected $table = 'food_categories';
    protected $guarded = ['id', 'company_id'];

    public function items()
    {
        return $this->hasMany(FoodItem::class, 'category_id');
    }
}

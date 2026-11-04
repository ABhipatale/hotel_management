<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class FoodItem extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];
    protected $casts = ['is_veg' => 'boolean', 'is_available' => 'boolean'];
    protected $appends = ['image_url'];

    public function getImageUrlAttribute(): ?string
    {
        return $this->image_path ? asset('storage/'.$this->image_path) : null;
    }

    public function category()
    {
        return $this->belongsTo(FoodCategory::class, 'category_id');
    }

    public function variants()
    {
        return $this->hasMany(FoodItemVariant::class);
    }
}

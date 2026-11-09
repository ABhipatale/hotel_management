<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class FoodItem extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];
    protected $casts = ['is_veg' => 'boolean', 'is_available' => 'boolean', 'code' => 'integer'];
    protected $appends = ['image_url'];

    protected static function booted(): void
    {
        // Every dish gets a short product number, unique inside its company, even when created without one.
        static::creating(function (self $m) {
            if ($m->code === null) {
                $m->code = ((int) static::withoutGlobalScopes()->where('company_id', $m->company_id)->max('code')) + 1;
            }
        });
    }

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

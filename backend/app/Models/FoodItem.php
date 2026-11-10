<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use App\Services\LibraryImages;
use App\Support\Tenant;
use Illuminate\Database\Eloquent\Model;

class FoodItem extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];
    protected $casts = ['is_veg' => 'boolean', 'is_available' => 'boolean', 'hide_library_image' => 'boolean', 'code' => 'integer'];
    protected $appends = ['image_url', 'image_source'];

    protected static function booted(): void
    {
        // Every dish gets a short product number, unique inside its company, even when created without one.
        static::creating(function (self $m) {
            if ($m->code === null) {
                $m->code = ((int) static::withoutGlobalScopes()->where('company_id', $m->company_id)->max('code')) + 1;
            }
        });
    }

    /**
     * Which picture a dish shows: its own upload, else a library photo the owner picked, else the platform library photo
     * that matches the dish name (unless the hotel switched platform images off or hid this dish's photo).
     *
     * @return array{0: ?string, 1: ?string} [stored path, source: own|library|null]
     */
    public function resolveImage(): array
    {
        if ($this->image_path) {
            return [$this->image_path, 'own'];
        }
        if ($this->hide_library_image || Tenant::company()?->use_library_images === false) {
            return [null, null];
        }
        $path = LibraryImages::pathById($this->library_image_id)
            ?? LibraryImages::pathById(LibraryImages::matchId($this->name, $this->name_mr));

        return $path ? [$path, 'library'] : [null, null];
    }

    public function getImageUrlAttribute(): ?string
    {
        $path = $this->resolveImage()[0];

        return $path ? asset('storage/'.$path) : null;
    }

    public function getImageSourceAttribute(): ?string
    {
        return $this->resolveImage()[1];
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

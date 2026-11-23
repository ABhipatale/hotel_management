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
    protected $casts = ['is_veg' => 'boolean', 'is_available' => 'boolean', 'hide_library_image' => 'boolean', 'code' => 'integer', 'sort_order' => 'integer'];
    protected $appends = ['image_url', 'image_source'];

    protected static function booted(): void
    {
        // Every dish gets a short product number, unique inside its company, even when created without one.
        static::creating(function (self $m) {
            if ($m->code === null) {
                $m->code = ((int) static::withoutGlobalScopes()->where('company_id', $m->company_id)->max('code')) + 1;
            }
            // Once the owner has arranged the menu, a new dish goes to the end; until then every dish stays at 0 (code order).
            if (! $m->sort_order) {
                $max = (int) static::withoutGlobalScopes()->where('company_id', $m->company_id)->max('sort_order');
                $m->sort_order = $max > 0 ? $max + 1 : 0;
            }
        });
    }

    /** The owner's name for the base option (e.g. "Half"); only meaningful while the dish has variants. Null = the plain dish, no label. */
    public function baseVariantLabel(): ?string
    {
        $n = trim((string) $this->base_variant_name);

        return $n !== '' && $this->variants->isNotEmpty() ? $n : null;
    }

    /** The one menu order used everywhere: arranged order, then product number, then name. */
    public function scopeInMenuOrder($q)
    {
        return $q->orderBy('sort_order')->orderByRaw('code is null')->orderBy('code')->orderBy('name');
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

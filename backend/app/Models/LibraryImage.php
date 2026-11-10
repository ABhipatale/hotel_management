<?php

namespace App\Models;

use App\Services\LibraryImages;
use Illuminate\Database\Eloquent\Model;

/** A platform-owned dish photo. Not tenant scoped: every hotel can read it, only the super admin can change it. */
class LibraryImage extends Model
{
    protected $guarded = ['id'];

    protected $appends = ['image_url'];

    protected static function booted(): void
    {
        static::saved(fn () => LibraryImages::flush());
        static::deleted(fn () => LibraryImages::flush());
    }

    public function getImageUrlAttribute(): string
    {
        return asset('storage/'.$this->image_path);
    }
}

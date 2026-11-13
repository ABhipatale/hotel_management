<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Company extends Model
{
    use SoftDeletes;

    protected $guarded = ['id', 'uid', 'status'];
    protected $casts = ['settings' => 'array', 'gst_enabled' => 'boolean', 'qr_enabled' => 'boolean', 'multi_counter' => 'boolean', 'use_library_images' => 'boolean'];
    protected $appends = ['logo_url', 'icon_url'];

    public function getIconUrlAttribute(): ?string
    {
        return $this->icon_path ? asset('storage/'.$this->icon_path.'-512.png') : null;
    }

    public function getLogoUrlAttribute(): ?string
    {
        return $this->logo_path ? asset('storage/'.$this->logo_path) : null;
    }

    public function subscriptions()
    {
        return $this->hasMany(Subscription::class);
    }

    public function currentSubscription()
    {
        return $this->hasOne(Subscription::class)->latestOfMany('ends_at');
    }

    public function users()
    {
        return $this->hasMany(User::class);
    }

    /** Public branding payload — safe to expose to unauthenticated QR menu visitors. */
    public function branding(): array
    {
        return [
            'name' => $this->name,
            'gst_enabled' => $this->gst_enabled,
            'default_language' => $this->default_language ?: 'en',
            'slug' => $this->slug,
            'logo_url' => $this->logo_url,
            'icon_url' => $this->icon_url,
            'brand_color' => $this->brand_color,
            'phone' => $this->phone,
            'address' => $this->address,
        ];
    }
}

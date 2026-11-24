<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

class Company extends Model
{
    use SoftDeletes;

    protected $guarded = ['id', 'uid', 'status'];
    protected $casts = ['settings' => 'array', 'gst_enabled' => 'boolean', 'qr_enabled' => 'boolean', 'multi_counter' => 'boolean', 'parcel_enabled' => 'boolean', 'table_sharing_enabled' => 'boolean', 'upi_qr_enabled' => 'boolean', 'payroll_enabled' => 'boolean', 'approval_pin' => 'hashed', 'staff_discount_percent' => 'float', 'kot_enabled' => 'boolean', 'kot_screen' => 'boolean', 'kot_print' => 'boolean', 'kot_unprinted_alert' => 'boolean', 'price_monthly' => 'float', 'price_yearly' => 'float', 'use_library_images' => 'boolean'];
    protected $hidden = ['approval_pin']; // the PIN hash never leaves the server
    protected $appends = ['logo_url', 'icon_url'];

    /** This company's own subscription price, or the platform default when none was set. */
    public function priceFor(SubscriptionPlan $plan, string $cycle): float
    {
        $own = $cycle === 'yearly' ? $this->price_yearly : $this->price_monthly;

        return (float) ($own ?? ($cycle === 'yearly' ? $plan->price_yearly : $plan->price_monthly));
    }

    /** @return array{price_monthly: float, price_yearly: float, custom: bool} */
    public function prices(SubscriptionPlan $plan): array
    {
        return [
            'price_monthly' => $this->priceFor($plan, 'monthly'),
            'price_yearly' => $this->priceFor($plan, 'yearly'),
            'custom' => $this->price_monthly !== null || $this->price_yearly !== null,
        ];
    }

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

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SubscriptionPlan extends Model
{
    protected $guarded = ['id'];
    protected $casts = ['features' => 'array', 'is_active' => 'boolean'];

    /** The product has a single subscription: the (first) active plan row just holds its two prices. */
    public static function current(): self
    {
        return static::where('is_active', true)->orderBy('id')->firstOrFail();
    }

    public function hasFeature(string $feature): bool
    {
        return in_array($feature, $this->features ?? [], true);
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Subscription extends Model
{
    protected $guarded = ['id'];
    protected $casts = ['starts_at' => 'datetime', 'ends_at' => 'datetime'];

    public function plan()
    {
        return $this->belongsTo(SubscriptionPlan::class, 'plan_id');
    }

    public function company()
    {
        return $this->belongsTo(Company::class);
    }

    public function isExpired(): bool
    {
        return $this->ends_at->isPast() || in_array($this->status, ['expired', 'cancelled'], true);
    }
}

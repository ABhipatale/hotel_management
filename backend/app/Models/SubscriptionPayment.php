<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class SubscriptionPayment extends Model
{
    protected $guarded = ['id'];
    protected $casts = ['paid_at' => 'datetime'];

    public function company()
    {
        return $this->belongsTo(Company::class);
    }
}

<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Bill extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $guarded = ['id', 'company_id'];

    public function items()
    {
        return $this->hasMany(BillItem::class);
    }

    public function payments()
    {
        return $this->hasMany(Payment::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}

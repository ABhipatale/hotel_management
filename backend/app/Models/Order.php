<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class Order extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];

    public function items()
    {
        return $this->hasMany(OrderItem::class);
    }

    public function table()
    {
        return $this->belongsTo(HotelTable::class, 'table_id');
    }

    public function waiter()
    {
        return $this->belongsTo(User::class, 'waiter_id');
    }

    public function bill()
    {
        return $this->hasOne(Bill::class);
    }
}

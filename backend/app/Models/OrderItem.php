<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use BelongsToCompany;

    protected $table = 'order_items';
    protected $guarded = ['id', 'company_id'];

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}

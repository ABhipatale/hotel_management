<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class OrderItem extends Model
{
    use BelongsToCompany;

    protected $table = 'order_items';
    protected $guarded = ['id', 'company_id'];

    /** The waiter / captain who added this line (orders of one table can be built by several people). */
    public function adder()
    {
        return $this->belongsTo(User::class, 'added_by');
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }
}

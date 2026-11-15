<?php

namespace App\Models;

use App\Models\Concerns\BelongsToBranch;
use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

/** Kitchen Order Ticket: the new (or cancelled) dishes of an order, sent to the kitchen in one go. */
class Kot extends Model
{
    use BelongsToBranch, BelongsToCompany;

    protected $table = 'kots';
    protected $guarded = ['id', 'company_id'];
    protected $casts = ['kot_date' => 'date:Y-m-d'];

    public function items()
    {
        return $this->hasMany(KotItem::class);
    }

    public function order()
    {
        return $this->belongsTo(Order::class);
    }

    public function sender()
    {
        return $this->belongsTo(User::class, 'sent_by');
    }
}

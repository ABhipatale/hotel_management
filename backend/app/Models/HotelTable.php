<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class HotelTable extends Model
{
    use BelongsToCompany;

    protected $table = 'hotel_tables';
    protected $guarded = ['id', 'company_id'];

    public function qrToken()
    {
        return $this->hasOne(TableQrToken::class, 'table_id')->where('is_active', true);
    }

    public function waiter()
    {
        return $this->belongsTo(User::class, 'waiter_id');
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'table_id');
    }
}

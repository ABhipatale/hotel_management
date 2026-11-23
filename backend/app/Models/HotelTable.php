<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class HotelTable extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $table = 'hotel_tables';
    protected $guarded = ['id', 'company_id'];
    protected $casts = ['is_split' => 'boolean'];

    public function qrToken()
    {
        return $this->hasOne(TableQrToken::class, 'table_id')->where('is_active', true);
    }

    public function waiter()
    {
        return $this->belongsTo(User::class, 'waiter_id');
    }

    public function parts()
    {
        return $this->hasMany(self::class, 'parent_id')->orderBy('id');
    }

    public function parent()
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    /** A part of a shared table: once neither part has an open order, the shared table closes and is one table again. */
    public function mergeIfIdle(): void
    {
        $parent = $this->parent_id ? self::find($this->parent_id) : ($this->is_split ? $this : null);
        if (! $parent || ! $parent->is_split) {
            return;
        }
        $ids = self::where('parent_id', $parent->id)->pluck('id');
        if (! Order::whereIn('table_id', $ids)->whereNotIn('status', ['paid', 'cancelled'])->exists()) {
            self::whereIn('id', $ids)->update(['status' => 'available']);
            $parent->update(['is_split' => false, 'status' => 'available']);
        }
    }

    public function orders()
    {
        return $this->hasMany(Order::class, 'table_id');
    }
}

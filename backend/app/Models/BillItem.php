<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class BillItem extends Model
{
    use BelongsToCompany;

    public $timestamps = false;
    protected $table = 'bill_items';
    protected $guarded = ['id', 'company_id'];
}

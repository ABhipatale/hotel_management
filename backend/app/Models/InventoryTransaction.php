<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class InventoryTransaction extends Model
{
    use BelongsToCompany;

    protected $table = 'inventory_transactions';
    protected $guarded = ['id', 'company_id'];
}

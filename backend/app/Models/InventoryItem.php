<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class InventoryItem extends Model
{
    use BelongsToCompany, \App\Models\Concerns\BelongsToBranch;

    protected $table = 'inventory_items';
    protected $guarded = ['id', 'company_id'];
}

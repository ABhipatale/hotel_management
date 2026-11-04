<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class InventoryItem extends Model
{
    use BelongsToCompany;

    protected $table = 'inventory_items';
    protected $guarded = ['id', 'company_id'];
}

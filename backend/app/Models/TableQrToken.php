<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class TableQrToken extends Model
{
    use BelongsToCompany;

    protected $table = 'table_qr_tokens';
    protected $guarded = ['id', 'company_id'];
}

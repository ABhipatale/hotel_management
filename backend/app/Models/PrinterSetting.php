<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

class PrinterSetting extends Model
{
    use BelongsToCompany;

    protected $table = 'printer_settings';
    protected $guarded = ['id', 'company_id'];
}

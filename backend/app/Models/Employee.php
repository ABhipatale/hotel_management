<?php

namespace App\Models;

use App\Models\Concerns\BelongsToCompany;
use Illuminate\Database\Eloquent\Model;

/** A person working in the hotel (cook, waiter, cleaner...). Not an app login. */
class Employee extends Model
{
    use BelongsToCompany;

    protected $guarded = ['id', 'company_id'];
    protected $casts = ['is_active' => 'boolean', 'monthly_salary' => 'float'];

    public function entries()
    {
        return $this->hasMany(EmployeeEntry::class);
    }

    /** What this person still owes the hotel: advances given - money handed back - advance deducted from salaries. */
    public function balance(): float
    {
        $e = $this->entries()->get(['type', 'amount', 'recovery']);

        return round($e->where('type', 'advance')->sum('amount') - $e->where('type', 'repayment')->sum('amount') - $e->where('type', 'salary')->sum('recovery'), 2);
    }
}

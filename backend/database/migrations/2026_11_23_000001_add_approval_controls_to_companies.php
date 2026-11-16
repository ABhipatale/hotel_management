<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Owner approval controls: a PIN (stored hashed) that staff need for risky actions (voiding a bill, a big extra discount,
 * cancelling an order the kitchen already started), and the extra discount a staff member may give without it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->string('approval_pin', 100)->nullable()->after('kot_print_mode');
            $t->decimal('staff_discount_percent', 5, 2)->default(10)->after('approval_pin');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn(['approval_pin', 'staff_discount_percent']));
    }
};

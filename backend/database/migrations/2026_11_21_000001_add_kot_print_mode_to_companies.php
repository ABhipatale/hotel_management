<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform-admin default for how the kitchen slip prints when an order is placed:
 * 'auto' (print by itself), 'ask' (Yes / No popup), 'off', or NULL = each device decides (the behaviour so far).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->string('kot_print_mode', 10)->nullable()->after('kot_print');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('kot_print_mode'));
    }
};

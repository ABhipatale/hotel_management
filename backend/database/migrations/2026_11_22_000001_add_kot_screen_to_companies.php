<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * KOT without the kitchen screen: when 'kot_screen' is off the hotel only gets printed kitchen slips
 * (no kitchen board, no chef login, no "ready" alerts). Default ON, so every company works as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('kot_screen')->default(true)->after('kot_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('kot_screen'));
    }
};

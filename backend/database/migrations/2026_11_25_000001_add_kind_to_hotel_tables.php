<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Parcel counters: "Parcel 1", "Parcel 2"... are kept in the same list as tables (kind = 'parcel'), so several parcel
 * orders can be open at once. Default 'table', so every existing table works exactly as before.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hotel_tables', function (Blueprint $t) {
            $t->string('kind', 10)->default('table')->after('number');
        });
    }

    public function down(): void
    {
        Schema::table('hotel_tables', fn (Blueprint $t) => $t->dropColumn('kind'));
    }
};

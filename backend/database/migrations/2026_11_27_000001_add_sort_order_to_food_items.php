<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The order owners arrange dishes in (Menu > Reorder). 0 for every dish = the old order (product number, then name). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->unsignedInteger('sort_order')->default(0)->after('code');
        });
    }

    public function down(): void
    {
        Schema::table('food_items', fn (Blueprint $t) => $t->dropColumn('sort_order'));
    }
};

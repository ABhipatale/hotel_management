<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Optional Marathi name of a variant (Half / Full...), printed on Marathi KOT slips and bills. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_item_variants', function (Blueprint $t) {
            $t->string('name_mr', 80)->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('food_item_variants', fn (Blueprint $t) => $t->dropColumn('name_mr'));
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Optional name of a dish's base option (shown as "Regular" when blank) once the dish has variants, e.g. "Half". */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->string('base_variant_name', 40)->nullable()->after('sort_order');
            $t->string('base_variant_name_mr', 80)->nullable()->after('base_variant_name');
        });
    }

    public function down(): void
    {
        Schema::table('food_items', fn (Blueprint $t) => $t->dropColumn(['base_variant_name', 'base_variant_name_mr']));
    }
};

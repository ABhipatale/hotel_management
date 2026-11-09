<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Optional Marathi name of a dish, shown next to the English name in menus.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->string('name_mr', 160)->nullable()->after('name');
        });
    }

    public function down(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->dropColumn('name_mr');
        });
    }
};

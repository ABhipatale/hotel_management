<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Short "product number" per dish (1 = Roti, 2 = Bhaji ...), unique inside one company, used for fast ordering.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->unsignedInteger('code')->nullable()->after('category_id');
        });

        // Number the dishes that already exist: 1..n per company, oldest first.
        $next = [];
        foreach (DB::table('food_items')->orderBy('company_id')->orderBy('id')->get(['id', 'company_id']) as $row) {
            $next[$row->company_id] = ($next[$row->company_id] ?? 0) + 1;
            DB::table('food_items')->where('id', $row->id)->update(['code' => $next[$row->company_id]]);
        }

        Schema::table('food_items', function (Blueprint $t) {
            $t->unique(['company_id', 'code'], 'food_items_company_code_unique');
        });
    }

    public function down(): void
    {
        Schema::table('food_items', function (Blueprint $t) {
            $t->dropUnique('food_items_company_code_unique');
            $t->dropColumn('code');
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Category names in two languages: the English app shows only "name", the Marathi app shows only "name_mr".
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('food_categories', function (Blueprint $t) {
            $t->string('name_mr', 80)->nullable()->after('name');
        });

        // Categories that were created as "Soup (सूप)" are split into English + Marathi (only when the brackets hold non-English text)
        foreach (DB::table('food_categories')->get(['id', 'name']) as $c) {
            if (preg_match('/^(.+?)\s*\(([^)]*[^\x00-\x7F][^)]*)\)\s*$/u', $c->name, $m)) {
                DB::table('food_categories')->where('id', $c->id)->update(['name' => trim($m[1]), 'name_mr' => trim($m[2])]);
            }
        }
    }

    public function down(): void
    {
        Schema::table('food_categories', fn (Blueprint $t) => $t->dropColumn('name_mr'));
    }
};

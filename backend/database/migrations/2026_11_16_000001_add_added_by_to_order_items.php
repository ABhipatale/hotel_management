<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// One open order per table: every item remembers which waiter / captain added it.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('order_items', function (Blueprint $t) {
            $t->unsignedBigInteger('added_by')->nullable()->after('order_id');
        });
    }

    public function down(): void
    {
        Schema::table('order_items', fn (Blueprint $t) => $t->dropColumn('added_by'));
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Where a table is ("Garden", "AC hall", "First floor"): shown with the table number on orders and order alerts.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('hotel_tables', function (Blueprint $t) {
            $t->string('section', 60)->nullable()->after('number');
        });
    }

    public function down(): void
    {
        Schema::table('hotel_tables', fn (Blueprint $t) => $t->dropColumn('section'));
    }
};

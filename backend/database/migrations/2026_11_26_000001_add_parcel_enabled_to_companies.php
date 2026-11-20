<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Parcel counters (Parcel 1, Parcel 2...) are an option the platform admin switches on per company. OFF for everyone by default. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('parcel_enabled')->default(false)->after('multi_counter');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('parcel_enabled'));
    }
};

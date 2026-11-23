<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Shared tables: one table can be split into two parts (T1A / T1B), each with its own order and bill.
 * The platform admin switches it on per company (OFF for everyone by default). The two parts are ordinary table rows pointing at their parent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('table_sharing_enabled')->default(false)->after('parcel_enabled');
        });
        Schema::table('hotel_tables', function (Blueprint $t) {
            $t->unsignedBigInteger('parent_id')->nullable()->after('kind')->index();
            $t->boolean('is_split')->default(false)->after('parent_id');
        });
    }

    public function down(): void
    {
        Schema::table('hotel_tables', fn (Blueprint $t) => $t->dropColumn(['parent_id', 'is_split']));
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('table_sharing_enabled'));
    }
};

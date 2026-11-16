<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Business type per company: 'restaurant' (hotel / restaurant, exactly as the app has always worked)
 * or 'cafe' (quick counter sale with token numbers). Existing companies stay 'restaurant'.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->string('business_type', 20)->default('restaurant')->after('multi_counter');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('business_type'));
    }
};

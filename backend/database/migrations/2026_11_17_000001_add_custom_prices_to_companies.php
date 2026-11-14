<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            // NULL = the company pays the platform's default price (every existing company). A value = its own price.
            $t->decimal('price_monthly', 10, 2)->nullable()->after('default_language');
            $t->decimal('price_yearly', 10, 2)->nullable()->after('price_monthly');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn(['price_monthly', 'price_yearly']));
    }
};

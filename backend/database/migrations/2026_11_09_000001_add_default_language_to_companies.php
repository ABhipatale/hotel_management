<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            // en | hi | mr : the language the app opens in for this company's users (until they pick their own)
            $t->string('default_language', 2)->default('en')->after('qr_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->dropColumn('default_language');
        });
    }
};

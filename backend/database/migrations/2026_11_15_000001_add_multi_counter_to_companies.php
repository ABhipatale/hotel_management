<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            // OFF for every existing company: they keep working exactly as before (one default counter).
            $t->boolean('multi_counter')->default(false)->after('qr_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('multi_counter'));
    }
};

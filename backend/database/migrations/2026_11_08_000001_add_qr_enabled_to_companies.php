<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            // QR table ordering is switched on per company by the platform admin (existing companies keep it on)
            $t->boolean('qr_enabled')->default(true)->after('gst_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->dropColumn('qr_enabled');
        });
    }
};

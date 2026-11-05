<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            // Controlled by the platform admin. Existing companies keep charging GST (default on).
            $t->boolean('gst_enabled')->default(true)->after('gst_number');
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->dropColumn('gst_enabled');
        });
    }
};

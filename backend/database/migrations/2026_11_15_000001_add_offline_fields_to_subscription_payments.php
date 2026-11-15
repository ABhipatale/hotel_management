<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('subscription_payments', function (Blueprint $t) {
            // online (gateway) | offline (cash / UPI / bank / cheque recorded by the super admin)
            $t->string('mode', 10)->default('online')->after('billing_cycle');
            $t->string('method', 20)->nullable()->after('mode');
            $t->string('note', 255)->nullable()->after('method');
        });
    }

    public function down(): void
    {
        Schema::table('subscription_payments', function (Blueprint $t) {
            $t->dropColumn(['mode', 'method', 'note']);
        });
    }
};

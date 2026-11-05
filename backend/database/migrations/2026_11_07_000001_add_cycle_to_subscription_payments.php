<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('subscription_payments', function (Blueprint $t) {
            // monthly | yearly: remembered on the pending payment so a webhook can activate the right period
            $t->string('billing_cycle', 10)->nullable()->after('amount');
        });
    }

    public function down(): void
    {
        Schema::table('subscription_payments', function (Blueprint $t) {
            $t->dropColumn('billing_cycle');
        });
    }
};

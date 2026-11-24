<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "KOT not printed" alerts: when a waiter's (or captain's) phone does not print the kitchen slip, the owner, counter manager and
 * captains see it with a red "Not printed" mark and a Print KOT button. Switched on per company by the platform admin.
 * Off by default, so every existing company keeps today's behaviour.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('kot_unprinted_alert')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->dropColumn('kot_unprinted_alert');
        });
    }
};

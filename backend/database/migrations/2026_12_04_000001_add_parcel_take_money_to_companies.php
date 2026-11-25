<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * "Take money" popup on parcel orders: when a parcel order is sent to the kitchen, the counter is asked at once whether
 * the customer paid (Cash / UPI → paid bill printed, no QR) or not (unpaid bill printed, with the UPI QR when that is on).
 * An option the platform admin switches on per company. OFF for everyone by default (nothing changes for existing hotels).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('parcel_take_money')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('parcel_take_money'));
    }
};

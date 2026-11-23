<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The hotel's UPI ID (and the name shown in the customer's UPI app): printed as a pay-by-scan QR on unpaid bills. Empty = no QR. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->string('upi_id', 80)->nullable();
            $t->string('upi_name', 60)->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn(['upi_id', 'upi_name']));
    }
};

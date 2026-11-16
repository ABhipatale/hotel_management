<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Orders saved on a device while it was offline are sent again and again until the server confirms. Each carries a unique
 * reference; the server remembers it here, so a retry (e.g. the connection dropped after the order was saved) never creates a second order.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('order_client_refs', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('ref', 40);
            $t->foreignId('order_id')->constrained()->cascadeOnDelete();
            $t->timestamp('created_at')->nullable();
            $t->unique(['company_id', 'ref']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('order_client_refs');
    }
};

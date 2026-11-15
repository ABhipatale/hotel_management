<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// A Chef (kitchen login) of a multi-counter company can cook for SEVERAL counters: the extra counters live here.
// Everyone else keeps their single users.branch_id. Empty table = nothing changes.
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('branch_user', function (Blueprint $t) {
            $t->foreignId('user_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->primary(['user_id', 'branch_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('branch_user');
    }
};

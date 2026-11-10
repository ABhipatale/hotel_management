<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

// Platform-wide dish photo library (managed by the super admin, read-only for hotels).
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('library_images', function (Blueprint $t) {
            $t->id();
            $t->string('name', 120);
            $t->string('name_mr', 160)->nullable();
            $t->string('aliases', 500)->nullable(); // comma separated extra spellings
            $t->string('image_path');
            $t->timestamps();
            $t->index('name');
        });

        Schema::table('food_items', function (Blueprint $t) {
            $t->unsignedBigInteger('library_image_id')->nullable()->after('image_path');
            $t->boolean('hide_library_image')->default(false)->after('library_image_id');
        });

        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('use_library_images')->default(true)->after('qr_enabled');
        });
    }

    public function down(): void
    {
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('use_library_images'));
        Schema::table('food_items', fn (Blueprint $t) => $t->dropColumn(['library_image_id', 'hide_library_image']));
        Schema::dropIfExists('library_images');
    }
};

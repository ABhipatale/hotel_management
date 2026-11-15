<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

// Optional Kitchen Order Tickets: platform admin switches it on per company. OFF everywhere by default, so nothing changes
// for existing hotels. Adds the two company switches, the ticket tables, the "Kitchen" permission and a "Chef" role.
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('kot_enabled')->default(false);
            $t->boolean('kot_print')->default(false); // also offer a printed kitchen slip (the kitchen screen is always there)
        });

        Schema::create('kots', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->unsignedBigInteger('branch_id')->nullable()->index();
            $t->foreignId('order_id')->constrained()->cascadeOnDelete();
            $t->date('kot_date');
            $t->unsignedInteger('number');                       // 1, 2, 3 ... restarts every day
            $t->string('type', 10)->default('new');              // new | cancel (a cancel ticket tells the kitchen to stop)
            $t->string('status', 12)->default('new');            // new | cooking | ready | served | cancelled
            $t->string('note')->nullable();
            $t->unsignedBigInteger('sent_by')->nullable();
            $t->timestamp('started_at')->nullable();
            $t->timestamp('ready_at')->nullable();
            $t->timestamp('served_at')->nullable();
            $t->timestamp('printed_at')->nullable();
            $t->timestamps();
            $t->index(['company_id', 'status']);
            $t->index(['company_id', 'kot_date']);
        });

        Schema::create('kot_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('kot_id')->constrained('kots')->cascadeOnDelete();
            $t->unsignedBigInteger('order_item_id')->nullable();
            $t->string('name');
            $t->string('variant')->nullable();
            $t->unsignedInteger('quantity');
            $t->timestamps();
        });

        // Permission + roles for every existing company
        $now = now();
        DB::table('permissions')->updateOrInsert(['slug' => 'orders.kitchen'], ['label' => 'Kitchen display (KOT)']);
        $kitchen = DB::table('permissions')->where('slug', 'orders.kitchen')->value('id');
        foreach (DB::table('companies')->pluck('id') as $companyId) {
            $owner = DB::table('roles')->where('company_id', $companyId)->where('slug', 'owner')->value('id');
            if ($owner) {
                DB::table('role_permissions')->insertOrIgnore(['role_id' => $owner, 'permission_id' => $kitchen]);
            }
            $chef = DB::table('roles')->where('company_id', $companyId)->where('slug', 'chef')->value('id')
                ?? DB::table('roles')->insertGetId(['company_id' => $companyId, 'name' => 'Chef', 'slug' => 'chef', 'created_at' => $now, 'updated_at' => $now]);
            DB::table('role_permissions')->insertOrIgnore(['role_id' => $chef, 'permission_id' => $kitchen]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('kot_items');
        Schema::dropIfExists('kots');
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn(['kot_enabled', 'kot_print']));
        $ids = DB::table('roles')->where('slug', 'chef')->pluck('id');
        DB::table('role_permissions')->whereIn('role_id', $ids)->delete();
        DB::table('roles')->whereIn('id', $ids)->delete();
        $p = DB::table('permissions')->where('slug', 'orders.kitchen')->value('id');
        DB::table('role_permissions')->where('permission_id', $p)->delete();
        DB::table('permissions')->where('id', $p)->delete();
    }
};

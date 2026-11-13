<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Every company gets a "Counter" manager role: runs ONE counter (tables, orders, bills, expenses, stock, that counter's reports).
return new class extends Migration
{
    public function up(): void
    {
        $perms = DB::table('permissions')->whereIn('slug', config('hms.role_defaults.counter'))->pluck('id');
        foreach (DB::table('companies')->pluck('id') as $companyId) {
            $role = DB::table('roles')->where('company_id', $companyId)->where('slug', 'counter')->first();
            $roleId = $role->id ?? DB::table('roles')->insertGetId(['company_id' => $companyId, 'name' => 'Counter', 'slug' => 'counter', 'created_at' => now(), 'updated_at' => now()]);
            foreach ($perms as $pid) {
                DB::table('role_permissions')->insertOrIgnore(['role_id' => $roleId, 'permission_id' => $pid]);
            }
        }
    }

    public function down(): void
    {
        $ids = DB::table('roles')->where('slug', 'counter')->pluck('id');
        DB::table('role_permissions')->whereIn('role_id', $ids)->delete();
        DB::table('roles')->whereIn('id', $ids)->delete();
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

// Every company gets a "Captain" role: takes and edits orders for tables, no billing.
return new class extends Migration
{
    public function up(): void
    {
        $perms = DB::table('permissions')->whereIn('slug', config('hms.role_defaults.captain'))->pluck('id');
        foreach (DB::table('companies')->pluck('id') as $companyId) {
            $role = DB::table('roles')->where('company_id', $companyId)->where('slug', 'captain')->first();
            $roleId = $role->id ?? DB::table('roles')->insertGetId(['company_id' => $companyId, 'name' => 'Captain', 'slug' => 'captain', 'created_at' => now(), 'updated_at' => now()]);
            foreach ($perms as $pid) {
                DB::table('role_permissions')->insertOrIgnore(['role_id' => $roleId, 'permission_id' => $pid]);
            }
        }
    }

    public function down(): void
    {
        $ids = DB::table('roles')->where('slug', 'captain')->pluck('id');
        DB::table('role_permissions')->whereIn('role_id', $ids)->delete();
        DB::table('roles')->whereIn('id', $ids)->delete();
    }
};

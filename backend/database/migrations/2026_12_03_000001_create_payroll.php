<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Staff salary & advances (pagar / uchal). The platform admin switches it on per company (OFF by default).
 *  employees        = the people who work in the hotel (cook, waiter, cleaner...), with their fixed monthly salary. They need no app login.
 *  employee_entries = their ledger: an advance given, money handed back, and the monthly salary paid (with its breakdown).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('companies', function (Blueprint $t) {
            $t->boolean('payroll_enabled')->default(false);
        });
        Schema::create('employees', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('name', 120);
            $t->string('job', 60)->nullable();
            $t->string('phone', 20)->nullable();
            $t->decimal('monthly_salary', 12, 2)->default(0);
            $t->date('join_date')->nullable();
            $t->boolean('is_active')->default(true);
            $t->string('notes', 255)->nullable();
            $t->timestamps();
        });
        Schema::create('employee_entries', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $t->string('type', 12);                       // advance | repayment | salary
            $t->date('entry_date');
            $t->decimal('amount', 12, 2);                 // advance / repayment: the amount. salary: the NET cash paid
            $t->string('month', 7)->nullable();           // salary: 2026-11
            $t->decimal('base_salary', 12, 2)->nullable();
            $t->decimal('absent_days', 4, 1)->nullable();
            $t->decimal('absent_deduction', 12, 2)->nullable();
            $t->decimal('bonus', 12, 2)->nullable();
            $t->decimal('recovery', 12, 2)->nullable();   // salary: advance deducted from this salary
            $t->string('method', 8)->default('cash');
            $t->string('note', 255)->nullable();
            $t->unsignedBigInteger('expense_id')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->index(['employee_id', 'type']);
            $t->unique(['employee_id', 'month']);         // one salary per person per month
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_entries');
        Schema::dropIfExists('employees');
        Schema::table('companies', fn (Blueprint $t) => $t->dropColumn('payroll_enabled'));
    }
};

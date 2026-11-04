<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('subscription_plans', function (Blueprint $t) {
            $t->id();
            $t->string('name');
            $t->string('slug')->unique();
            $t->decimal('price_monthly', 10, 2)->default(0);
            $t->decimal('price_yearly', 10, 2)->default(0);
            $t->unsignedInteger('max_staff')->nullable();    // null = unlimited
            $t->unsignedInteger('max_tables')->nullable();
            $t->unsignedInteger('max_branches')->default(1);
            $t->json('features')->nullable();                // qr, thermal, reports, inventory, expenses, pnl, multi_branch
            $t->unsignedInteger('trial_days')->default(14);
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        Schema::create('companies', function (Blueprint $t) {
            $t->id();
            $t->string('uid', 20)->unique();                 // public company ID
            $t->string('slug')->unique();                    // used in QR URLs
            $t->string('name');
            $t->string('business_name')->nullable();
            $t->string('logo_path')->nullable();
            $t->string('address')->nullable();
            $t->string('city')->nullable();
            $t->string('state')->nullable();
            $t->string('pin_code', 10)->nullable();
            $t->string('phone', 20)->nullable();
            $t->string('email')->nullable();
            $t->string('gst_number', 20)->nullable();
            $t->string('brand_color', 9)->default('#4f46e5');
            $t->text('bill_header')->nullable();
            $t->text('bill_footer')->nullable();
            $t->enum('status', ['trial', 'active', 'inactive', 'suspended'])->default('trial');
            $t->json('settings')->nullable();
            $t->softDeletes();
            $t->timestamps();
        });

        Schema::create('subscriptions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('plan_id')->constrained('subscription_plans');
            $t->enum('billing_cycle', ['trial', 'monthly', 'yearly'])->default('trial');
            $t->enum('status', ['trial', 'active', 'expired', 'cancelled'])->default('trial');
            $t->dateTime('starts_at');
            $t->dateTime('ends_at');
            $t->timestamps();
            $t->index(['company_id', 'status']);
        });

        Schema::create('subscription_payments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('subscription_id')->nullable()->constrained()->nullOnDelete();
            $t->string('invoice_no')->unique();
            $t->decimal('amount', 10, 2);
            $t->string('gateway')->nullable();
            $t->string('gateway_ref')->nullable();
            $t->enum('status', ['pending', 'paid', 'failed', 'refunded'])->default('pending');
            $t->timestamp('paid_at')->nullable();
            $t->timestamps();
        });

        Schema::create('platform_settings', function (Blueprint $t) {
            $t->id();
            $t->string('key')->unique();
            $t->text('value')->nullable();
            $t->timestamps();
        });

        Schema::create('support_tickets', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->unsignedBigInteger('user_id')->nullable();
            $t->string('subject');
            $t->text('message');
            $t->enum('status', ['open', 'in_progress', 'resolved', 'closed'])->default('open');
            $t->text('reply')->nullable();
            $t->timestamps();
        });

        Schema::create('cache', function (Blueprint $t) {
            $t->string('key')->primary();
            $t->mediumText('value');
            $t->integer('expiration');
        });
        Schema::create('cache_locks', function (Blueprint $t) {
            $t->string('key')->primary();
            $t->string('owner');
            $t->integer('expiration');
        });
    }

    public function down(): void
    {
        foreach (['cache_locks', 'cache', 'support_tickets', 'platform_settings', 'subscription_payments', 'subscriptions', 'companies', 'subscription_plans'] as $tbl) {
            Schema::dropIfExists($tbl);
        }
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    /** Every tenant table carries company_id (and branch_id where branch-specific). */
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $t) {
            $t->id();
            $t->string('slug')->unique();
            $t->string('label');
        });

        Schema::create('roles', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('slug');
            $t->timestamps();
            $t->unique(['company_id', 'slug']);
        });

        Schema::create('role_permissions', function (Blueprint $t) {
            $t->foreignId('role_id')->constrained()->cascadeOnDelete();
            $t->foreignId('permission_id')->constrained()->cascadeOnDelete();
            $t->primary(['role_id', 'permission_id']);
        });

        Schema::create('branches', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('address')->nullable();
            $t->unsignedBigInteger('manager_id')->nullable();
            $t->boolean('is_default')->default(false);
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        Schema::create('users', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->nullable()->constrained()->cascadeOnDelete(); // null => super admin
            $t->foreignId('branch_id')->nullable()->constrained()->nullOnDelete();
            $t->foreignId('role_id')->nullable()->constrained()->nullOnDelete();
            $t->string('role')->default('waiter');   // super_admin|owner|manager|waiter|kitchen|cashier
            $t->string('name');
            $t->string('email')->unique();
            $t->string('phone', 20)->nullable();
            $t->string('password');
            $t->boolean('is_active')->default(true);
            $t->timestamp('last_login_at')->nullable();
            $t->rememberToken();
            $t->timestamps();
        });

        Schema::create('password_reset_tokens', function (Blueprint $t) {
            $t->string('email')->primary();
            $t->string('token');
            $t->timestamp('created_at')->nullable();
        });

        Schema::create('hotel_tables', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->string('number');
            $t->unsignedSmallInteger('capacity')->default(4);
            $t->enum('status', ['available', 'occupied', 'reserved', 'preparing', 'ready', 'billing', 'paid'])->default('available');
            $t->foreignId('waiter_id')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['company_id', 'branch_id', 'number']);
        });

        Schema::create('table_qr_tokens', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('table_id')->constrained('hotel_tables')->cascadeOnDelete();
            $t->string('token', 64)->unique();       // random, non-guessable
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        Schema::create('food_categories', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->unsignedInteger('sort_order')->default(0);
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });

        Schema::create('food_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->nullable()->constrained()->cascadeOnDelete();
            $t->foreignId('category_id')->constrained('food_categories')->cascadeOnDelete();
            $t->string('name');
            $t->text('description')->nullable();
            $t->string('image_path')->nullable();
            $t->decimal('price', 10, 2);
            $t->decimal('gst_percent', 5, 2)->default(5);
            $t->decimal('discount_percent', 5, 2)->default(0);
            $t->boolean('is_veg')->default(true);
            $t->boolean('is_available')->default(true);
            $t->integer('stock')->nullable();
            $t->string('offer_text')->nullable();
            $t->timestamps();
        });

        Schema::create('food_item_variants', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('food_item_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->decimal('price', 10, 2);
            $t->timestamps();
        });

        Schema::create('customers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('name')->nullable();
            $t->string('phone', 20)->nullable();
            $t->timestamps();
            $t->index(['company_id', 'phone']);
        });

        Schema::create('orders', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->string('order_no');
            $t->foreignId('table_id')->nullable()->constrained('hotel_tables')->nullOnDelete();
            $t->foreignId('waiter_id')->nullable()->constrained('users')->nullOnDelete();
            $t->foreignId('customer_id')->nullable()->constrained()->nullOnDelete();
            $t->enum('type', ['dine_in', 'takeaway', 'delivery'])->default('dine_in');
            $t->enum('source', ['staff', 'qr'])->default('staff');
            $t->enum('status', ['pending', 'accepted', 'preparing', 'ready', 'served', 'billed', 'paid', 'cancelled'])->default('pending');
            $t->string('customer_name')->nullable();
            $t->string('customer_phone', 20)->nullable();
            $t->string('notes')->nullable();
            $t->timestamps();
            $t->unique(['company_id', 'order_no']);
            $t->index(['company_id', 'branch_id', 'status']);
        });

        Schema::create('order_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('order_id')->constrained()->cascadeOnDelete();
            $t->foreignId('food_item_id')->nullable()->constrained()->nullOnDelete();
            $t->string('name');
            $t->string('variant')->nullable();
            $t->unsignedInteger('quantity');
            $t->decimal('price', 10, 2);
            $t->decimal('gst_percent', 5, 2)->default(0);
            $t->decimal('discount_percent', 5, 2)->default(0);
            $t->enum('status', ['pending', 'preparing', 'ready', 'served', 'cancelled'])->default('pending');
            $t->timestamps();
        });

        Schema::create('bills', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->foreignId('order_id')->constrained()->cascadeOnDelete();
            $t->string('bill_no');
            $t->decimal('subtotal', 12, 2);
            $t->decimal('discount', 12, 2)->default(0);
            $t->decimal('tax', 12, 2)->default(0);
            $t->decimal('grand_total', 12, 2);
            $t->enum('status', ['unpaid', 'paid', 'void'])->default('unpaid');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
            $t->unique(['company_id', 'bill_no']);
        });

        Schema::create('bill_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('bill_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->unsignedInteger('quantity');
            $t->decimal('price', 10, 2);
            $t->decimal('discount', 10, 2)->default(0);
            $t->decimal('tax', 10, 2)->default(0);
            $t->decimal('total', 10, 2);
        });

        Schema::create('payments', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->foreignId('bill_id')->constrained()->cascadeOnDelete();
            $t->enum('method', ['cash', 'card', 'upi', 'wallet']);
            $t->decimal('amount', 12, 2);
            $t->string('reference')->nullable();
            $t->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('expenses', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->string('category');
            $t->string('description')->nullable();
            $t->decimal('amount', 12, 2);
            $t->date('expense_date');
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('suppliers', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('phone', 20)->nullable();
            $t->string('address')->nullable();
            $t->timestamps();
        });

        Schema::create('inventory_items', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->string('name');
            $t->string('unit', 20)->default('kg');
            $t->decimal('quantity', 12, 3)->default(0);
            $t->decimal('min_quantity', 12, 3)->default(0);
            $t->timestamps();
        });

        Schema::create('purchases', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->constrained()->cascadeOnDelete();
            $t->foreignId('supplier_id')->nullable()->constrained()->nullOnDelete();
            $t->decimal('total', 12, 2);
            $t->date('purchase_date');
            $t->timestamps();
        });

        Schema::create('inventory_transactions', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('inventory_item_id')->constrained()->cascadeOnDelete();
            $t->foreignId('purchase_id')->nullable()->constrained()->nullOnDelete();
            $t->enum('type', ['in', 'out', 'adjust']);
            $t->decimal('quantity', 12, 3);
            $t->string('note')->nullable();
            $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $t->timestamps();
        });

        Schema::create('printer_settings', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('branch_id')->nullable()->constrained()->cascadeOnDelete();
            $t->enum('paper_width', ['58mm', '80mm'])->default('80mm');
            $t->enum('connection', ['bluetooth', 'usb', 'network', 'browser'])->default('browser');
            $t->string('ip_address')->nullable();
            $t->unsignedInteger('port')->nullable();
            $t->boolean('use_escpos')->default(true);
            $t->boolean('show_logo')->default(true);
            $t->timestamps();
        });

        Schema::create('notifications', function (Blueprint $t) {
            $t->id();
            $t->foreignId('company_id')->constrained()->cascadeOnDelete();
            $t->foreignId('user_id')->nullable()->constrained()->cascadeOnDelete();
            $t->string('title');
            $t->string('body')->nullable();
            $t->timestamp('read_at')->nullable();
            $t->timestamps();
        });

        Schema::create('audit_logs', function (Blueprint $t) {
            $t->id();
            $t->unsignedBigInteger('company_id')->nullable()->index();
            $t->unsignedBigInteger('user_id')->nullable();
            $t->string('action');
            $t->string('entity')->nullable();
            $t->unsignedBigInteger('entity_id')->nullable();
            $t->json('meta')->nullable();
            $t->string('ip', 45)->nullable();
            $t->timestamps();
        });

        Schema::create('sessions', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->foreignId('user_id')->nullable()->index();
            $t->string('ip_address', 45)->nullable();
            $t->text('user_agent')->nullable();
            $t->longText('payload');
            $t->integer('last_activity')->index();
        });
    }

    public function down(): void
    {
        foreach (['sessions', 'audit_logs', 'notifications', 'printer_settings', 'inventory_transactions', 'purchases', 'inventory_items', 'suppliers', 'expenses', 'payments', 'bill_items', 'bills', 'order_items', 'orders', 'customers', 'food_item_variants', 'food_items', 'food_categories', 'table_qr_tokens', 'hotel_tables', 'password_reset_tokens', 'users', 'branches', 'role_permissions', 'roles', 'permissions'] as $tbl) {
            Schema::dropIfExists($tbl);
        }
    }
};

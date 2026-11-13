<?php

use App\Http\Controllers\Api\AuthController;
use App\Http\Controllers\Api\BillingController;
use App\Http\Controllers\Api\CounterController;
use App\Http\Controllers\Api\LibraryController;
use App\Http\Controllers\Api\MenuController;
use App\Http\Controllers\Api\OperationsController;
use App\Http\Controllers\Api\OrderController;
use App\Http\Controllers\Api\PaymentWebhookController;
use App\Http\Controllers\Api\PublicMenuController;
use App\Http\Controllers\Api\ReportController;
use App\Http\Controllers\Api\SettingsController;
use App\Http\Controllers\Api\StaffController;
use App\Http\Controllers\Api\SubscriptionController;
use App\Http\Controllers\Api\Super\SuperAdminController;
use App\Http\Controllers\Api\TableController;
use Illuminate\Support\Facades\Route;

// ---------- Public ----------
Route::post('auth/login', [AuthController::class, 'login'])->middleware('throttle:auth');

// Razorpay server-to-server notification (signature verified inside the controller)
Route::post('webhooks/razorpay', [PaymentWebhookController::class, 'razorpay'])->middleware('throttle:60,1');

// Per-company PWA manifest: each company gets its own installable app name, colour and icon.
Route::get('public/manifest/{slug}.webmanifest', [PublicMenuController::class, 'manifest'])
    ->where('slug', '[a-z0-9-]+')->middleware('throttle:public-menu');

Route::prefix('public/menu/{slug}/table/{token}')->group(function () {
    Route::get('/', [PublicMenuController::class, 'menu'])->middleware('throttle:public-menu');
    Route::get('orders', [PublicMenuController::class, 'active'])->middleware('throttle:public-menu');
    Route::post('orders', [PublicMenuController::class, 'order'])->middleware('throttle:public-order');
    Route::get('orders/{orderNo}', [PublicMenuController::class, 'track'])->middleware('throttle:public-menu');
});

// ---------- Authenticated ----------
Route::middleware(['auth:sanctum', 'throttle:api'])->group(function () {
    Route::get('auth/me', [AuthController::class, 'me']);
    Route::post('auth/logout', [AuthController::class, 'logout']);

    // ----- Super admin (platform) -----
    Route::prefix('admin')->middleware('superadmin')->group(function () {
        Route::get('dashboard', [SuperAdminController::class, 'dashboard']);
        Route::get('companies', [SuperAdminController::class, 'companies']);
        Route::post('companies', [SuperAdminController::class, 'storeCompany']);
        Route::get('companies/{id}', [SuperAdminController::class, 'showCompany']);
        Route::put('companies/{id}', [SuperAdminController::class, 'updateCompany']);
        Route::patch('companies/{id}/status', [SuperAdminController::class, 'setStatus']);
        Route::post('companies/{id}/branding', [SuperAdminController::class, 'branding']);
        Route::post('companies/{id}/subscription', [SuperAdminController::class, 'assignSubscription']);
        Route::delete('companies/{id}', [SuperAdminController::class, 'destroyCompany']);
        Route::get('companies/{id}/counters', [SuperAdminController::class, 'counters']);
        Route::post('companies/{id}/counters', [SuperAdminController::class, 'storeCounter']);
        Route::put('companies/{id}/counters/{counterId}', [SuperAdminController::class, 'updateCounter']);
        Route::get('library', [LibraryController::class, 'adminIndex']);
        Route::post('library', [LibraryController::class, 'store']);
        Route::post('library/{id}', [LibraryController::class, 'update']); // POST for multipart
        Route::delete('library/{id}', [LibraryController::class, 'destroy']);
        Route::get('pricing', [SuperAdminController::class, 'pricing']);
        Route::put('pricing', [SuperAdminController::class, 'savePricing']);
        Route::get('payments', [SuperAdminController::class, 'payments']);
        Route::get('settings', [SuperAdminController::class, 'settings']);
        Route::put('settings', [SuperAdminController::class, 'saveSettings']);
        Route::get('tickets', [SuperAdminController::class, 'tickets']);
        Route::put('tickets/{id}', [SuperAdminController::class, 'replyTicket']);
    });

    // ----- Tenant (company) -----
    Route::middleware('tenant')->group(function () {
        Route::get('dashboard', [ReportController::class, 'dashboard'])->middleware('perm:dashboard.view');

        // Subscription (always reachable, even when expired)
        Route::get('subscription', [SubscriptionController::class, 'current']);
        Route::get('subscription/pricing', [SubscriptionController::class, 'pricing']);
        Route::get('subscription/payments', [SubscriptionController::class, 'payments'])->middleware('perm:subscription.manage');
        Route::post('subscription/checkout', [SubscriptionController::class, 'checkout'])->middleware('perm:subscription.manage');
        Route::post('subscription/confirm', [SubscriptionController::class, 'confirm'])->middleware('perm:subscription.manage');
        Route::get('support', [SettingsController::class, 'tickets']);
        Route::post('support', [SettingsController::class, 'createTicket']);

        // Company settings / branding / printer
        Route::get('company', [SettingsController::class, 'company']);
        Route::post('company', [SettingsController::class, 'updateCompany'])->middleware('perm:settings.manage');
        Route::get('printer', [SettingsController::class, 'printer']);
        Route::put('printer', [SettingsController::class, 'updatePrinter'])->middleware('perm:settings.manage');
        Route::get('permissions', [SettingsController::class, 'permissions']);
        Route::get('audit-logs', [SettingsController::class, 'auditLogs'])->middleware('perm:settings.manage');

        // Counters (multi-counter companies, owner only - checked in the controller)
        Route::get('counters/overview', [CounterController::class, 'overview']);
        Route::post('counters', [CounterController::class, 'store']);
        Route::put('counters/{id}', [CounterController::class, 'update']);

        // Staff
        Route::middleware('perm:users.manage')->group(function () {
            Route::get('staff', [StaffController::class, 'index']);
            Route::post('staff', [StaffController::class, 'store']);
            Route::put('staff/{id}', [StaffController::class, 'update']);
            Route::delete('staff/{id}', [StaffController::class, 'destroy']);
            Route::get('staff/{id}/activity', [StaffController::class, 'activity']);
        });

        // Tables
        Route::get('tables', [TableController::class, 'index'])->middleware('perm:tables.view');
        Route::middleware('perm:tables.manage')->group(function () {
            Route::post('tables', [TableController::class, 'store']);
            Route::put('tables/{id}', [TableController::class, 'update']);
            Route::delete('tables/{id}', [TableController::class, 'destroy']);
            Route::post('tables/{id}/qr/regenerate', [TableController::class, 'regenerateQr'])->middleware('feature:qr');
            Route::get('tables/{id}/qr', [TableController::class, 'qr'])->middleware('feature:qr');
        });
        // Staff (waiters) may update a table's status
        Route::patch('tables/{id}/status', [TableController::class, 'setStatus'])->middleware('perm:orders.create,tables.manage');

        // Menu
        Route::middleware('perm:menu.view')->group(function () {
            Route::get('menu/categories', [MenuController::class, 'categories']);
            Route::get('menu/items', [MenuController::class, 'items']);
        });
        Route::middleware('perm:menu.manage')->group(function () {
            Route::post('menu/categories/reorder', [MenuController::class, 'reorderCategories']);
            Route::post('menu/categories', [MenuController::class, 'storeCategory']);
            Route::put('menu/categories/{id}', [MenuController::class, 'updateCategory']);
            Route::delete('menu/categories/{id}', [MenuController::class, 'destroyCategory']);
            Route::post('menu/import', [MenuController::class, 'import']);
            Route::get('library', [LibraryController::class, 'index']);
            Route::get('menu/next-code', [MenuController::class, 'nextCode']);
            Route::post('menu/items', [MenuController::class, 'storeItem']);
            Route::post('menu/items/{id}', [MenuController::class, 'updateItem']); // POST for multipart
            Route::delete('menu/items/{id}', [MenuController::class, 'destroyItem']);
        });

        // Orders
        Route::get('orders', [OrderController::class, 'index'])->middleware('perm:orders.view');
        Route::get('orders/kitchen', [OrderController::class, 'kitchen'])->middleware('perm:orders.kitchen');
        Route::get('orders/feed', [OrderController::class, 'feed'])->middleware('perm:billing.manage');
        Route::get('orders/{id}', [OrderController::class, 'show'])->middleware('perm:orders.view');
        Route::post('orders', [OrderController::class, 'store'])->middleware('perm:orders.create');
        Route::post('orders/{id}/items', [OrderController::class, 'addItems'])->middleware('perm:orders.create');
        Route::put('orders/{id}/items', [OrderController::class, 'updateItems'])->middleware('perm:orders.create');
        Route::patch('orders/{id}/status', [OrderController::class, 'updateStatus'])->middleware('perm:orders.create,billing.manage');
        Route::patch('order-items/{id}/status', [OrderController::class, 'updateItemStatus'])->middleware('perm:billing.manage');

        // Billing
        // Billing needs the billing permission (a Captain, who only takes orders, has orders.create but not this)
        Route::middleware('perm:billing.manage')->group(function () {
            Route::get('bills', [BillingController::class, 'index']);
            Route::get('bills/{id}', [BillingController::class, 'show']);
            Route::post('orders/{orderId}/bill', [BillingController::class, 'generate']);
        });
        Route::middleware('perm:billing.manage')->group(function () {
            Route::post('bills/{id}/pay', [BillingController::class, 'pay']);
            Route::delete('bills/{id}', [BillingController::class, 'void']);
        });

        // Expenses / inventory (plan-gated)
        Route::middleware(['perm:expenses.manage', 'feature:expenses'])->group(function () {
            Route::get('expenses', [OperationsController::class, 'expenses']);
            Route::post('expenses', [OperationsController::class, 'storeExpense']);
            Route::put('expenses/{id}', [OperationsController::class, 'updateExpense']);
            Route::delete('expenses/{id}', [OperationsController::class, 'destroyExpense']);
        });
        Route::middleware(['perm:inventory.manage', 'feature:inventory'])->group(function () {
            Route::get('inventory', [OperationsController::class, 'inventory']);
            Route::post('inventory', [OperationsController::class, 'storeInventory']);
            Route::put('inventory/{id}', [OperationsController::class, 'updateInventory']);
            Route::delete('inventory/{id}', [OperationsController::class, 'destroyInventory']);
            Route::post('inventory/{id}/move', [OperationsController::class, 'moveStock']);
            Route::get('inventory/{id}/transactions', [OperationsController::class, 'transactions']);
            Route::get('suppliers', [OperationsController::class, 'suppliers']);
            Route::post('suppliers', [OperationsController::class, 'storeSupplier']);
            Route::get('purchases', [OperationsController::class, 'purchases']);
            Route::post('purchases', [OperationsController::class, 'storePurchase']);
        });

        // Reports (basic = 'reports', advanced types need the advanced plan)
        Route::middleware(['perm:reports.view', 'feature:reports'])->group(function () {
            Route::get('reports/{type}', [ReportController::class, 'report'])
                ->where('type', 'sales|tables|waiters|items|payments|inventory|expenses|pnl');
        });
    });
});

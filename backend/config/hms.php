<?php

return [
    'permissions' => [
        'dashboard.view' => 'View dashboard',
        'users.manage' => 'Manage staff',
        'tables.view' => 'View tables',
        'tables.manage' => 'Manage tables',
        'menu.view' => 'View menu',
        'menu.manage' => 'Manage menu',
        'orders.view' => 'View orders',
        'orders.create' => 'Create orders',
        'orders.kitchen' => 'Kitchen display (KOT)',
        'billing.manage' => 'Generate bills & take payments',
        'expenses.manage' => 'Manage expenses',
        'inventory.manage' => 'Manage inventory',
        'reports.view' => 'View reports',
        'settings.manage' => 'Manage company settings',
        'subscription.manage' => 'Manage subscription',
    ],

    // '*' = everything. Seeded as per-company roles at registration, editable by owner.
    'role_defaults' => [
        'owner' => ['*'],
        // Waiter: take orders and generate bills. No dashboard/reports/expenses (no profit & loss).
        'waiter' => ['tables.view', 'menu.view', 'orders.view', 'orders.create', 'billing.manage'],
        // Captain: takes and edits orders for tables. No billing, no payments, no reports.
        'captain' => ['tables.view', 'menu.view', 'orders.view', 'orders.create'],
        // Counter manager (multi-counter companies): runs ONE counter - its tables, orders, bills, expenses, stock and reports.
        // Sees nothing of the other counters. No staff / settings / subscription / menu editing (those stay with the owner).
        // Chef (only when KOT is on): sees the kitchen screen and nothing else.
        'chef' => ['orders.kitchen'],
        'counter' => ['dashboard.view', 'tables.view', 'tables.manage', 'menu.view', 'orders.view', 'orders.create', 'billing.manage', 'expenses.manage', 'inventory.manage', 'reports.view'],
    ],

    'default_categories' => ['Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Beverages', 'Desserts'],

    // Features a plan can unlock. Core: tables, menu, orders, billing.
    'features' => ['qr', 'thermal', 'reports', 'advanced_reports', 'inventory', 'expenses', 'pnl', 'advanced_permissions'],

    // The hotel's clock for deciding what "today" is (bill / KOT numbers restart at midnight here, reports cut their days here).
    // Timestamps themselves stay stored in UTC.
    'timezone' => env('HMS_TIMEZONE', 'Asia/Kolkata'),

    // Customer QR ordering: most orders that may wait for staff approval at one table at the same time (stops spam / pranks)
    'qr_max_pending' => (int) env('HMS_QR_MAX_PENDING', 3),

    // What happens after subscription expiry: read-only keeps data viewable; block denies all tenant access.
    'expiry_policy' => env('HMS_EXPIRY_POLICY', 'read_only'),
];

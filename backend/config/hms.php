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
    ],

    'default_categories' => ['Starters', 'Main Course', 'Breads', 'Rice & Biryani', 'Beverages', 'Desserts'],

    // Features a plan can unlock. Core: tables, menu, orders, billing.
    'features' => ['qr', 'thermal', 'reports', 'advanced_reports', 'inventory', 'expenses', 'pnl', 'advanced_permissions'],

    // What happens after subscription expiry: read-only keeps data viewable; block denies all tenant access.
    'expiry_policy' => env('HMS_EXPIRY_POLICY', 'read_only'),
];

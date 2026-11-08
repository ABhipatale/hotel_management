# Hotel SaaS — multi-company hotel & restaurant management (PWA)

- `backend/` — Laravel 12 API (Sanctum, RBAC, multi-tenant via `company_id`)
- `frontend/` — React + Vite + Tailwind 4 PWA

## Run locally

```bash
# backend (MySQL: create DB `hms_saas`, edit backend/.env)
cd backend
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate --seed
php artisan storage:link
php artisan serve                 # http://localhost:8000

# frontend
cd frontend
npm install
npm run dev                       # http://localhost:5173 (proxies /api and /storage to :8000)
```

Seeded logins (non-production only):

| Role | Email | Password |
|---|---|---|
| Super admin | admin@hms.test | Admin@12345 |
| Hotel Atithi owner (Premium) | atithi@demo.test | Dem o@12345 |
| Friends Restaurant owner (Premium) | friends@demo.test | Demo@12345 |
| Waiter (per company) | `waiter.` + owner email, e.g. `waiter.atithi@demo.test` | Demo@12345 |  

## Tenant isolation design

- `App\Support\Tenant` holds the tenant, set **only** by `ResolveTenant` middleware from the authenticated user
  (or from a verified QR slug+token). Request `company_id` is never read.
- `BelongsToCompany` adds a **fail-closed** global scope (no tenant ⇒ `1 = 0`) and stamps `company_id` on create.
- Foreign keys in requests are validated with `Tenant::exists()` (id must belong to the tenant).
- Super admin routes run inside an explicit `Tenant::unscoped()`.
- `backend/tests/Feature/TenantIsolationTest.php` covers cross-tenant reads/writes, FK injection, QR token replay,
  RBAC, plan limits, subscription expiry and billing. Run: `cd backend && php artisan test`.

## Not finished / needs your decision before production

- **Payment gateway**: `POST /api/subscription` is a simulated gateway outside production and returns 501 in
  production. Integrate Razorpay/Stripe with server-side verification (webhook) before launch.
- **Real-time**: tables/orders use polling (5–10 s). Laravel Reverb/WebSockets not wired yet.
- **Network thermal printers** cannot be reached from a browser; they use the browser print dialog. USB/Bluetooth
  ESC/POS works in Chromium browsers (WebUSB / Web Bluetooth) and is untested on real hardware.
- **Scheduled jobs** (marking expired subscriptions, purging soft-deleted companies per retention policy) not added.
- UI has not been tested across browsers/devices; only the API and build were verified.

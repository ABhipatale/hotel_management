<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HotelTable;
use App\Models\TableQrToken;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use SimpleSoftwareIO\QrCode\Facades\QrCode;

class TableController extends Controller
{
    private const STATUSES = ['available', 'occupied', 'reserved', 'preparing', 'ready', 'billing', 'paid'];

    public function index(Request $r)
    {
        return HotelTable::where('branch_id', $this->branch($r))
            ->with('qrToken:id,table_id,token', 'waiter:id,name')
            ->withCount(['orders as open_orders' => fn ($q) => $q->whereNotIn('status', ['paid', 'cancelled'])])
            ->withMin(['orders as open_since' => fn ($q) => $q->whereNotIn('status', ['paid', 'cancelled'])], 'created_at')
            ->orderByRaw('LENGTH(number), number')->get();
    }

    public function store(Request $r)
    {
        $branch = $this->branch($r);
        $plan = $r->attributes->get('plan');
        if ($plan?->max_tables !== null && HotelTable::count() >= $plan->max_tables) {
            return response()->json(['message' => "Your plan allows up to {$plan->max_tables} tables. Please upgrade.", 'code' => 'limit_reached'], 402);
        }
        $data = $r->validate([
            'number' => ['required', 'string', 'max:20', Rule::unique('hotel_tables')->where('company_id', Tenant::id())->where('branch_id', $branch)],
            'capacity' => 'required|integer|min:1|max:50',
            'waiter_id' => ['nullable', 'integer'],
        ]);
        $this->checkWaiter($data['waiter_id'] ?? null);

        $table = HotelTable::create($data + ['branch_id' => $branch]);
        $this->issueToken($table);

        return response()->json($table->load('qrToken'), 201);
    }

    public function update(Request $r, int $id)
    {
        $t = HotelTable::findOrFail($id);
        $data = $r->validate([
            'number' => ['sometimes', 'string', 'max:20', Rule::unique('hotel_tables')->where('company_id', Tenant::id())->where('branch_id', $t->branch_id)->ignore($t->id)],
            'capacity' => 'sometimes|integer|min:1|max:50',
            'status' => ['sometimes', Rule::in(self::STATUSES)],
            'waiter_id' => ['nullable', 'integer'],
        ]);
        $this->checkWaiter($data['waiter_id'] ?? null);
        $t->update($data);

        return $t->load('qrToken', 'waiter:id,name');
    }

    /** Status-only update for floor staff (cannot rename tables or reassign waiters). */
    public function setStatus(Request $r, int $id)
    {
        $t = HotelTable::findOrFail($id);
        $d = $r->validate(['status' => ['required', Rule::in(self::STATUSES)]]);
        $t->update($d);

        return $t;
    }

    public function destroy(int $id)
    {
        $t = HotelTable::findOrFail($id);
        abort_if($t->orders()->whereNotIn('status', ['paid', 'cancelled'])->exists(), 422, 'Table has open orders.');
        $t->delete();

        return response()->noContent();
    }

    /** Rotate the QR token (invalidates the printed QR). */
    public function regenerateQr(int $id)
    {
        $t = HotelTable::findOrFail($id);
        TableQrToken::where('table_id', $t->id)->update(['is_active' => false]);
        $this->issueToken($t);

        return $t->load('qrToken');
    }

    /** SVG QR for a table, pointing at the company-specific public menu URL. */
    public function qr(int $id)
    {
        $t = HotelTable::with('qrToken')->findOrFail($id);
        abort_unless($t->qrToken, 404);
        $url = rtrim(config('app.frontend_url'), '/').'/menu/'.Tenant::company()->slug.'/table/'.$t->qrToken->token;

        return response(QrCode::format('svg')->size(300)->margin(1)->generate($url), 200, ['Content-Type' => 'image/svg+xml']);
    }

    private function issueToken(HotelTable $t): void
    {
        TableQrToken::create(['table_id' => $t->id, 'token' => Str::random(40)]);
    }

    private function checkWaiter(?int $id): void
    {
        if ($id) {
            abort_unless(\App\Models\User::inTenant(Tenant::id())->whereKey($id)->exists(), 422, 'Invalid waiter.');
        }
    }
}

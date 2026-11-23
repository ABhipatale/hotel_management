<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\HotelTable;
use App\Models\TableQrToken;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
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
        $isParcel = $r->input('kind') === 'parcel';
        abort_if($isParcel && ! Tenant::company()?->parcel_enabled, 403, 'Parcel counters are not enabled for this hotel. Ask the platform admin to switch them on.');
        if (! $isParcel && $plan?->max_tables !== null && HotelTable::withoutGlobalScope('branch')->where('kind', '!=', 'parcel')->count() >= $plan->max_tables) { // parcel counters are not tables: they do not use the plan's table limit
            return response()->json(['message' => "Your plan allows up to {$plan->max_tables} tables. Please upgrade.", 'code' => 'limit_reached'], 402);
        }
        // A table's name can carry a prefix ("G" + "1" = "G1"). "T" / no prefix keeps the bare number, exactly as before.
        // The final name is only known after it is built, so a prefixed table (and a parcel) is checked for duplicates on that final name.
        $prefix = $isParcel ? '' : $this->prefixOf($r);
        $bare = ! $isParcel && $this->isBare($prefix);
        $data = $r->validate([
            'kind' => 'nullable|in:table,parcel',
            'number' => array_filter(['required', 'string', 'max:20', $bare ? Rule::unique('hotel_tables')->where('company_id', Tenant::id())->where('branch_id', $branch) : null]),
            'prefix' => 'nullable|string',
            'capacity' => 'required|integer|min:1|max:50',
            'section' => 'nullable|string|max:60',
            'waiter_id' => ['nullable', 'integer'],
        ]);
        unset($data['prefix']);
        if ($isParcel) {
            // "3" and "Parcel 3" both become "Parcel 3" (the name carries the label everywhere: orders, kitchen slip, bill)
            $data['number'] = 'Parcel '.trim(preg_replace('/^parcel\s*/i', '', $data['number']));
            abort_if(HotelTable::where('branch_id', $branch)->where('number', $data['number'])->exists(), 422, $data['number'].' already exists.');
        } elseif (! $bare) {
            $data['number'] = $this->nameWith($prefix, $data['number']);
            abort_if(HotelTable::where('branch_id', $branch)->where('number', $data['number'])->exists(), 422, 'Table '.$data['number'].' already exists.');
        }
        $data['kind'] = $isParcel ? 'parcel' : 'table';
        $this->checkWaiter($data['waiter_id'] ?? null);

        $table = HotelTable::create($data + ['branch_id' => $branch]);
        $this->issueToken($table);

        return response()->json($table->load('qrToken'), 201);
    }

    public function update(Request $r, int $id)
    {
        $t = HotelTable::findOrFail($id);
        // `prefix` (tables only) rebuilds the name from prefix + number; an old app that sends no prefix renames exactly as before.
        $withPrefix = $t->kind !== 'parcel' && $r->has('prefix');
        $prefix = $withPrefix ? $this->prefixOf($r) : '';
        $bare = ! $withPrefix || $this->isBare($prefix);
        $data = $r->validate([
            'number' => ['sometimes', 'string', 'max:20', $bare ? Rule::unique('hotel_tables')->where('company_id', Tenant::id())->where('branch_id', $t->branch_id)->ignore($t->id) : 'required'],
            'prefix' => 'nullable|string',
            'capacity' => 'sometimes|integer|min:1|max:50',
            'section' => 'nullable|string|max:60',
            'status' => ['sometimes', Rule::in(self::STATUSES)],
            'waiter_id' => ['nullable', 'integer'],
        ]);
        unset($data['prefix']);
        if ($withPrefix && ! $bare && isset($data['number'])) {
            $data['number'] = $this->nameWith($prefix, $data['number']);
            abort_if(HotelTable::where('branch_id', $t->branch_id)->where('number', $data['number'])->where('id', '!=', $t->id)->exists(), 422, 'Table '.$data['number'].' already exists.');
        }
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

    /** The prefix sent with the request: letters A-Z only, up to 6, upper case. Refuses "P" / "PARCEL" (a table must never look like a parcel). */
    private function prefixOf(Request $r): string
    {
        $raw = trim((string) $r->input('prefix', ''));
        if ($raw === '') {
            return '';
        }
        $p = strtoupper($raw);
        if (! preg_match('/^[A-Z]{1,6}$/', $p) || in_array($p, ['P', 'PARCEL'], true)) {
            throw ValidationException::withMessages(['prefix' => 'The prefix must be 1 to 6 letters (A-Z) and cannot be P or PARCEL.']);
        }

        return $p;
    }

    /** "T" or no prefix: the table keeps its bare number (as it always did). */
    private function isBare(string $prefix): bool
    {
        return $prefix === '' || $prefix === 'T';
    }

    /** "G" + "1" = "G1". If the number already starts with the prefix ("G" + "G1") it is not doubled. */
    private function nameWith(string $prefix, string $number): string
    {
        $number = trim($number);
        $name = str_starts_with(strtoupper($number), $prefix) ? $prefix.substr($number, strlen($prefix)) : $prefix.$number;
        if (mb_strlen($name) > 20) {
            throw ValidationException::withMessages(['number' => 'The table name is too long (20 characters at most).']);
        }

        return $name;
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

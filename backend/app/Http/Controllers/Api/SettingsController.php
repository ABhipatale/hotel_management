<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\PrinterSetting;
use App\Models\SupportTicket;
use App\Services\BrandingService;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SettingsController extends Controller
{
    public function company()
    {
        return Tenant::company();
    }

    /** Owner approval controls: whether a PIN is set (never the PIN itself) and the discount staff may give without it. */
    public function approvals()
    {
        $c = Tenant::company();

        return ['has_pin' => ! empty($c->approval_pin), 'staff_discount_percent' => (float) ($c->staff_discount_percent ?? 10)];
    }

    public function saveApprovals(Request $r)
    {
        abort_unless($r->user()->role === 'owner', 403, 'Only the owner can change approvals.');
        $d = $r->validate([
            'pin' => ['nullable', 'digits_between:4,8'],
            'clear_pin' => 'sometimes|boolean',
            'staff_discount_percent' => 'sometimes|numeric|min:0|max:100',
        ]);
        $c = Tenant::company();
        $update = [];
        if (! empty($d['pin'])) {
            $update['approval_pin'] = $d['pin']; // hashed by the model
        }
        if ($r->boolean('clear_pin')) {
            $update['approval_pin'] = null;
        }
        if (array_key_exists('staff_discount_percent', $d)) {
            $update['staff_discount_percent'] = $d['staff_discount_percent'];
        }
        if ($update) {
            $c->update($update);
            AuditLog::record('approvals.update', 'company', $c->id, ['pin' => array_key_exists('approval_pin', $update) ? ($update['approval_pin'] === null ? 'removed' : 'changed') : null, 'staff_discount_percent' => $update['staff_discount_percent'] ?? null]);
        }

        return $this->approvals();
    }

    /** Company profile + branding (logo, colour, bill header/footer, GST). */
    public function updateCompany(Request $r)
    {
        $c = Tenant::company();
        $d = $r->validate([
            'name' => 'sometimes|string|max:120',
            'phone' => 'nullable|string|max:20',
            'email' => 'nullable|email',
            'address' => 'nullable|string|max:255',
            'city' => 'nullable|string|max:80',
            'state' => 'nullable|string|max:80',
            'pin_code' => 'nullable|string|max:10',
            'gst_number' => 'nullable|string|max:20',
            'upi_id' => ['nullable', 'string', 'max:80', 'regex:/^[A-Za-z0-9._-]{2,}@[A-Za-z][A-Za-z0-9.-]{1,}$/'], // UPI payment QR on the bill
            'upi_name' => 'nullable|string|max:60',
            'brand_color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'bill_header' => 'nullable|string|max:300',
            'bill_footer' => 'nullable|string|max:300',
            'logo' => 'nullable|image|max:2048',
            'icon' => 'nullable|image|mimes:png,jpg,jpeg,webp|max:2048|dimensions:min_width=192,min_height=192',
            'remove_icon' => 'sometimes|boolean',
        ]);
        $branding = app(BrandingService::class);
        if ($r->hasFile('logo')) {
            $branding->storeLogo($c, $r->file('logo'));
        }
        if ($r->hasFile('icon')) {
            $branding->storeIcon($c, $r->file('icon'));
        } elseif ($r->boolean('remove_icon')) {
            $branding->deleteIcon($c);
        }
        unset($d['logo'], $d['icon'], $d['remove_icon']);
        if (! $c->gst_enabled) {
            unset($d['gst_number']); // GST fields are locked by the platform admin
        }
        if (! $c->upi_qr_enabled) {
            unset($d['upi_id'], $d['upi_name']); // the UPI QR is switched on by the platform admin
        }
        $c->fill($d)->save();
        AuditLog::record('company.update', 'company', $c->id);

        return $c->refresh();
    }

    public function printer(Request $r)
    {
        return PrinterSetting::where('branch_id', $this->branch($r))->first()
            ?? PrinterSetting::whereNull('branch_id')->first();
    }

    public function updatePrinter(Request $r)
    {
        $d = $r->validate([
            'paper_width' => 'required|in:58mm,80mm',
            'connection' => 'required|in:bluetooth,usb,network,browser',
            'ip_address' => 'nullable|ip',
            'port' => 'nullable|integer|min:1|max:65535',
            'use_escpos' => 'boolean',
            'show_logo' => 'boolean',
        ]);
        if (in_array($d['connection'], ['usb', 'bluetooth'], true) || $d['connection'] === 'browser') {
            $d['ip_address'] = $d['port'] = null;
        }

        return PrinterSetting::updateOrCreate(['branch_id' => $this->branch($r)], $d);
    }

    public function auditLogs()
    {
        return AuditLog::where('company_id', Tenant::id())->latest()->limit(200)->get();
    }

    public function permissions()
    {
        return config('hms.permissions');
    }

    // ---- Support tickets ----
    public function tickets(Request $r)
    {
        return SupportTicket::where('company_id', Tenant::id())->latest()->get();
    }

    public function createTicket(Request $r)
    {
        $d = $r->validate(['subject' => 'required|string|max:160', 'message' => 'required|string|max:3000']);

        return response()->json(SupportTicket::create($d + ['company_id' => Tenant::id(), 'user_id' => $r->user()->id]), 201);
    }
}

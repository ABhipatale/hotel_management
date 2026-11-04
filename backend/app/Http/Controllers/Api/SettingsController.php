<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\PrinterSetting;
use App\Models\SupportTicket;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class SettingsController extends Controller
{
    public function company()
    {
        return Tenant::company();
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
            'brand_color' => ['nullable', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'bill_header' => 'nullable|string|max:300',
            'bill_footer' => 'nullable|string|max:300',
            'logo' => 'nullable|image|max:2048',
        ]);
        if ($r->hasFile('logo')) {
            if ($c->logo_path) {
                Storage::disk('public')->delete($c->logo_path);
            }
            $d['logo_path'] = $r->file('logo')->store('logos', 'public');
        }
        unset($d['logo']);
        $c->update($d);
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

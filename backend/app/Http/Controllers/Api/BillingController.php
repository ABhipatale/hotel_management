<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bill;
use App\Models\Order;
use App\Models\PrinterSetting;
use App\Services\OrderService;
use App\Support\Tenant;
use Illuminate\Http\Request;

class BillingController extends Controller
{
    public function __construct(private OrderService $orders)
    {
    }

    public function index(Request $r)
    {
        $q = Bill::with('order:id,order_no,table_id,type', 'order.table:id,number', 'payments:id,bill_id,method,amount')
            ->where('branch_id', $this->branch($r));
        if ($r->user()->role === 'waiter') {
            $q->whereHas('order', fn ($o) => $o->where('waiter_id', $r->user()->id));
        }
        if ($s = $r->query('status')) {
            $q->where('status', $s);
        }
        if ($d = $r->query('date')) {
            $q->whereDate('created_at', $d);
        }

        return $q->latest()->limit(200)->get();
    }

    public function generate(Request $r, int $orderId)
    {
        $order = Order::findOrFail($orderId);
        $d = $r->validate(['extra_discount' => 'nullable|numeric|min:0']);
        $bill = $this->orders->generateBill($order, $r->user(), (float) ($d['extra_discount'] ?? 0));
        AuditLog::record('bill.generate', 'bill', $bill->id);

        return response()->json($bill, 201);
    }

    public function show(int $id)
    {
        return $this->receiptPayload(Bill::with('items', 'payments', 'order.table:id,number', 'order.waiter:id,name')->findOrFail($id));
    }

    public function pay(Request $r, int $id)
    {
        $bill = Bill::findOrFail($id);
        $d = $r->validate([
            'payments' => 'required|array|min:1|max:5',
            'payments.*.method' => 'required|in:cash,upi',
            'payments.*.amount' => 'required|numeric|min:0.01',
            'payments.*.reference' => 'nullable|string|max:80',
        ]);
        $bill = $this->orders->pay($bill, $d['payments'], $r->user());
        AuditLog::record('bill.pay', 'bill', $bill->id, ['total' => $bill->grand_total]);

        return $this->receiptPayload($bill->load('order.table:id,number', 'order.waiter:id,name'));
    }

    public function void(Request $r, int $id)
    {
        $bill = Bill::findOrFail($id);
        abort_if($bill->status === 'paid', 422, 'Paid bills cannot be voided.');
        $bill->update(['status' => 'void']);
        $bill->order->update(['status' => 'served']);
        $bill->order->table?->update(['status' => 'occupied']);
        $bill->delete(); // frees the order for re-billing
        AuditLog::record('bill.void', 'bill', $id);

        return response()->noContent();
    }

    /** Everything the thermal/browser printer & WhatsApp share need — branded per company. */
    private function receiptPayload(Bill $bill): array
    {
        $c = Tenant::company();
        $printer = PrinterSetting::where(fn ($q) => $q->where('branch_id', $bill->branch_id)->orWhereNull('branch_id'))->orderByDesc('branch_id')->first();

        return [
            'bill' => $bill,
            // No GSTIN on the bill when GST is switched off for this company
            'company' => array_merge($c->only('name', 'logo_url', 'address', 'phone', 'gst_number', 'gst_enabled', 'bill_header', 'bill_footer', 'brand_color'), $c->gst_enabled ? [] : ['gst_number' => null]),
            'printer' => $printer,
            'table' => $bill->order?->table?->number,
            'order_no' => $bill->order?->order_no,
            'waiter' => $bill->order?->waiter?->name,
        ];
    }
}

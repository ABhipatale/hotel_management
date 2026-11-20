<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bill;
use App\Models\Order;
use App\Models\PrinterSetting;
use App\Services\ApprovalService;
use App\Services\OrderService;
use App\Support\BizTime;
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
            ->withSum('items as item_discount', 'discount')
            ->when($this->branchScope($r), fn ($q, $b) => $q->where('branch_id', $b));
        if ($r->user()->role === 'waiter') {
            $q->whereHas('order', fn ($o) => $o->where('waiter_id', $r->user()->id));
        }
        if ($s = $r->query('status')) {
            $q->where('status', $s);
        }
        if ($d = $r->query('date')) {
            $q->whereBetween('created_at', [BizTime::dayStart($d), BizTime::dayEnd($d)]); // that day in India
        }

        return $q->latest()->limit(200)->get();
    }

    public function generate(Request $r, int $orderId)
    {
        $order = Order::findOrFail($orderId);
        $d = $r->validate(['extra_discount' => 'nullable|numeric|min:0|max:10000000']);
        $extra = (float) ($d['extra_discount'] ?? 0);
        $isNew = ! $order->bill; // an existing bill is returned as it is: no discount is applied, so none is checked or logged

        // Staff may give an extra discount up to the company's limit; above it the owner's approval PIN is needed
        $approved = null;
        if ($isNew && $extra > 0) {
            if ($r->user()->role === 'owner') {
                $approved = 'owner';
            } else {
                $limit = (float) (Tenant::company()?->staff_discount_percent ?? 10);
                $base = $this->orders->grossSubtotal($order);
                $approved = ($base > 0 && $extra <= round($base * $limit / 100, 2) + 0.005)
                    ? 'within limit'
                    : app(ApprovalService::class)->require($r, 'A discount above '.rtrim(rtrim(number_format($limit, 2), '0'), '.').'%');
            }
        }

        $bill = $this->orders->generateBill($order, $r->user(), $isNew ? $extra : 0.0);
        AuditLog::record('bill.generate', 'bill', $bill->id, $isNew && $extra > 0
            ? ['bill_no' => $bill->bill_no, 'order_no' => $order->order_no, 'branch_id' => $bill->branch_id, 'subtotal' => (float) $bill->subtotal, 'extra_discount' => $extra, 'approved' => $approved]
            : []);

        return response()->json($bill, 201);
    }

    /** Discount on the Collect-payment screen: same limit and approval rules as a discount given when the bill is made. */
    public function discount(Request $r, int $id)
    {
        $bill = Bill::with('order')->findOrFail($id);
        abort_if($bill->status !== 'unpaid', 422, 'Bill is not payable.');
        $d = $r->validate(['amount' => 'required|numeric|min:0|max:10000000']);
        $extra = round((float) $d['amount'], 2);
        $current = max(0.0, round((float) $bill->discount - (float) $bill->items()->sum('discount'), 2));
        abort_if($extra > round((float) $bill->subtotal - (float) $bill->items()->sum('discount'), 2) + 0.005, 422, 'Discount cannot be more than the bill.');

        $approved = null;
        if ($extra > 0 && abs($extra - $current) > 0.004) {
            if ($r->user()->role === 'owner') {
                $approved = 'owner';
            } else {
                $limit = (float) (Tenant::company()?->staff_discount_percent ?? 10);
                $base = $bill->order ? $this->orders->grossSubtotal($bill->order) : (float) $bill->subtotal;
                $approved = ($base > 0 && $extra <= round($base * $limit / 100, 2) + 0.005)
                    ? 'within limit'
                    : app(ApprovalService::class)->require($r, 'A discount above '.rtrim(rtrim(number_format($limit, 2), '0'), '.').'%');
            }
        }

        $bill = $this->orders->setBillDiscount($bill, $extra);
        $bill->loadSum('items as item_discount', 'discount');
        if ($approved) {
            AuditLog::record('bill.generate', 'bill', $bill->id, ['bill_no' => $bill->bill_no, 'order_no' => $bill->order?->order_no, 'branch_id' => $bill->branch_id, 'subtotal' => (float) $bill->subtotal, 'extra_discount' => $extra, 'approved' => $approved]);
        }

        return $bill;
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
            'customer_name' => 'nullable|string|max:120',   // takeaway / parcel: asked at checkout, printed on the bill
        ]);
        if (! empty($d['customer_name'])) {
            $bill->order?->update(['customer_name' => trim($d['customer_name'])]);
        }
        $bill = $this->orders->pay($bill, $d['payments'], $r->user());
        AuditLog::record('bill.pay', 'bill', $bill->id, ['total' => $bill->grand_total]);

        return $this->receiptPayload($bill->load('order.table:id,number', 'order.waiter:id,name'));
    }

    public function void(Request $r, int $id)
    {
        $d = $r->validate(['reason' => 'required|string|min:3|max:120']);
        $bill = Bill::findOrFail($id);
        abort_if($bill->status === 'paid', 422, 'Paid bills cannot be voided.');
        // The owner may void; anybody else needs the owner's approval PIN. The reason and the amount are always remembered.
        $approved = app(ApprovalService::class)->require($r, 'Cancelling a bill');
        $meta = ['bill_no' => $bill->bill_no, 'order_no' => $bill->order?->order_no, 'branch_id' => $bill->branch_id, 'total' => (float) $bill->grand_total, 'reason' => $d['reason'], 'approved' => $approved];
        $bill->update(['status' => 'void']);
        $bill->order->update(['status' => 'served']);
        $bill->order->table?->update(['status' => 'occupied']);
        $bill->delete(); // frees the order for re-billing
        AuditLog::record('bill.void', 'bill', $id, $meta);

        return response()->noContent();
    }

    /** Bill lines only store the English dish name (+ " (variant)"): attach the dish's Marathi name so the bill can be printed in Marathi. */
    private function addMarathiNames(Bill $bill): void
    {
        $bill->loadMissing('items');
        $base = fn (string $n) => trim(preg_replace('/\s*\([^)]*\)$/u', '', $n));
        $names = $bill->items->flatMap(fn ($i) => [$i->name, $base($i->name)])->unique()->values()->all();
        $mr = \App\Models\FoodItem::whereIn('name', $names)->whereNotNull('name_mr')->pluck('name_mr', 'name');
        foreach ($bill->items as $i) {
            $variant = preg_match('/\(([^)]*)\)$/u', $i->name, $m) ? $m[1] : null;
            $i->setAttribute('name_mr', $mr[$i->name] ?? (isset($mr[$base($i->name)]) ? $mr[$base($i->name)].($variant ? " ($variant)" : '') : null));
        }
    }

    /** Everything the thermal/browser printer & WhatsApp share need — branded per company. */
    private function receiptPayload(Bill $bill): array
    {
        $c = Tenant::company();
        $this->addMarathiNames($bill);
        $printer = PrinterSetting::where(fn ($q) => $q->where('branch_id', $bill->branch_id)->orWhereNull('branch_id'))->orderByDesc('branch_id')->first();

        return [
            'bill' => $bill,
            // No GSTIN on the bill when GST is switched off for this company
            'company' => array_merge($c->only('name', 'logo_url', 'address', 'phone', 'gst_number', 'gst_enabled', 'bill_header', 'bill_footer', 'brand_color'), $c->gst_enabled ? [] : ['gst_number' => null]),
            'printer' => $printer,
            'table' => $bill->order?->table?->number,
            'order_no' => $bill->order?->order_no,
            'waiter' => $bill->order?->waiter?->name,
            'customer_name' => $bill->order?->customer_name,
        ];
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Expense;
use App\Models\InventoryItem;
use App\Models\InventoryTransaction;
use App\Models\Purchase;
use App\Models\Supplier;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Expenses, inventory, suppliers & purchases. */
class OperationsController extends Controller
{
    // ---- Expenses ----
    public function expenses(Request $r)
    {
        $q = Expense::where('branch_id', $this->branch($r));
        if ($f = $r->query('from')) {
            $q->whereDate('expense_date', '>=', $f);
        }
        if ($t = $r->query('to')) {
            $q->whereDate('expense_date', '<=', $t);
        }

        return $q->latest('expense_date')->limit(300)->get();
    }

    public function storeExpense(Request $r)
    {
        $d = $r->validate(['category' => 'required|string|max:60', 'description' => 'nullable|string|max:255', 'amount' => 'required|numeric|min:0.01', 'expense_date' => 'required|date']);
        $e = Expense::create($d + ['branch_id' => $this->branch($r), 'created_by' => $r->user()->id]);
        AuditLog::record('expense.create', 'expense', $e->id, ['amount' => $e->amount]);

        return response()->json($e, 201);
    }

    public function updateExpense(Request $r, int $id)
    {
        $e = Expense::findOrFail($id);
        $e->update($r->validate(['category' => 'sometimes|string|max:60', 'description' => 'nullable|string|max:255', 'amount' => 'sometimes|numeric|min:0.01', 'expense_date' => 'sometimes|date']));

        return $e;
    }

    public function destroyExpense(int $id)
    {
        Expense::findOrFail($id)->delete();
        AuditLog::record('expense.delete', 'expense', $id);

        return response()->noContent();
    }

    // ---- Inventory ----
    public function inventory(Request $r)
    {
        $items = InventoryItem::where('branch_id', $this->branch($r))->orderBy('name')->get();

        return $items->map(fn ($i) => $i->toArray() + ['low_stock' => $i->quantity <= $i->min_quantity]);
    }

    public function storeInventory(Request $r)
    {
        $d = $r->validate(['name' => 'required|string|max:120', 'unit' => 'required|string|max:20', 'quantity' => 'numeric|min:0', 'min_quantity' => 'numeric|min:0']);

        return response()->json(InventoryItem::create($d + ['branch_id' => $this->branch($r)]), 201);
    }

    public function updateInventory(Request $r, int $id)
    {
        $i = InventoryItem::findOrFail($id);
        $i->update($r->validate(['name' => 'sometimes|string|max:120', 'unit' => 'sometimes|string|max:20', 'min_quantity' => 'numeric|min:0']));

        return $i;
    }

    public function destroyInventory(int $id)
    {
        InventoryItem::findOrFail($id)->delete();

        return response()->noContent();
    }

    /** Stock movement (in/out/adjust) — atomic with row lock. */
    public function moveStock(Request $r, int $id)
    {
        $d = $r->validate(['type' => 'required|in:in,out,adjust', 'quantity' => 'required|numeric|min:0', 'note' => 'nullable|string|max:255']);

        return DB::transaction(function () use ($r, $id, $d) {
            $item = InventoryItem::lockForUpdate()->findOrFail($id);
            $new = match ($d['type']) {
                'in' => $item->quantity + $d['quantity'],
                'out' => $item->quantity - $d['quantity'],
                'adjust' => $d['quantity'],
            };
            abort_if($new < 0, 422, 'Not enough stock.');
            $item->update(['quantity' => $new]);
            InventoryTransaction::create(['inventory_item_id' => $item->id, 'type' => $d['type'], 'quantity' => $d['quantity'], 'note' => $d['note'] ?? null, 'created_by' => $r->user()->id]);

            return $item;
        });
    }

    public function transactions(int $id)
    {
        InventoryItem::findOrFail($id);

        return InventoryTransaction::where('inventory_item_id', $id)->latest()->limit(100)->get();
    }

    // ---- Suppliers & purchases ----
    public function suppliers()
    {
        return Supplier::orderBy('name')->get();
    }

    public function storeSupplier(Request $r)
    {
        return response()->json(Supplier::create($r->validate(['name' => 'required|string|max:120', 'phone' => 'nullable|string|max:20', 'address' => 'nullable|string|max:255'])), 201);
    }

    public function purchases(Request $r)
    {
        return Purchase::where('branch_id', $this->branch($r))->latest('purchase_date')->limit(200)->get();
    }

    /** Purchase: stocks inventory in and records an expense in one transaction. */
    public function storePurchase(Request $r)
    {
        $d = $r->validate([
            'supplier_id' => ['nullable', Tenant::exists('suppliers')],
            'purchase_date' => 'required|date',
            'lines' => 'required|array|min:1',
            'lines.*.inventory_item_id' => ['required', Tenant::exists('inventory_items')],
            'lines.*.quantity' => 'required|numeric|min:0.001',
            'lines.*.cost' => 'required|numeric|min:0',
        ]);
        $branch = $this->branch($r);

        return DB::transaction(function () use ($d, $r, $branch) {
            $total = collect($d['lines'])->sum(fn ($l) => $l['cost']);
            $p = Purchase::create(['branch_id' => $branch, 'supplier_id' => $d['supplier_id'] ?? null, 'total' => $total, 'purchase_date' => $d['purchase_date']]);
            foreach ($d['lines'] as $l) {
                $item = InventoryItem::lockForUpdate()->where('branch_id', $branch)->findOrFail($l['inventory_item_id']);
                $item->increment('quantity', $l['quantity']);
                InventoryTransaction::create(['inventory_item_id' => $item->id, 'purchase_id' => $p->id, 'type' => 'in', 'quantity' => $l['quantity'], 'note' => 'Purchase #'.$p->id, 'created_by' => $r->user()->id]);
            }
            Expense::create(['branch_id' => $branch, 'category' => 'Inventory purchase', 'description' => 'Purchase #'.$p->id, 'amount' => $total, 'expense_date' => $d['purchase_date'], 'created_by' => $r->user()->id]);

            return response()->json($p, 201);
        });
    }
}

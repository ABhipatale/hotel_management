<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Branch;
use App\Support\Tenant;
use Illuminate\Http\Request;

class BranchController extends Controller
{
    public function index()
    {
        return Branch::orderByDesc('is_default')->orderBy('name')->get();
    }

    public function store(Request $r)
    {
        $plan = $r->attributes->get('plan');
        if (Branch::count() >= ($plan?->max_branches ?? 1)) {
            return response()->json(['message' => 'Branch limit reached for your plan. Upgrade to add more branches.', 'code' => 'limit_reached'], 402);
        }
        $data = $this->rules($r);

        return response()->json(Branch::create($data), 201);
    }

    public function update(Request $r, int $id)
    {
        $b = Branch::findOrFail($id);
        $b->update($this->rules($r));

        return $b;
    }

    public function destroy(int $id)
    {
        $b = Branch::findOrFail($id);
        abort_if($b->is_default, 422, 'The default branch cannot be deleted.');
        abort_if(\App\Models\Order::where('branch_id', $id)->exists(), 422, 'This branch has orders; deactivate it instead.');
        $b->delete();

        return response()->noContent();
    }

    private function rules(Request $r): array
    {
        $d = $r->validate([
            'name' => 'required|string|max:120',
            'address' => 'nullable|string|max:255',
            'manager_id' => 'nullable|integer',
            'is_active' => 'sometimes|boolean',
        ]);
        if (! empty($d['manager_id'])) {
            abort_unless(\App\Models\User::inTenant(Tenant::id())->whereKey($d['manager_id'])->exists(), 422, 'Invalid manager.');
        }

        return $d;
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Role;
use App\Models\User;
use App\Support\Tenant;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class StaffController extends Controller
{
    private const ASSIGNABLE = ['waiter', 'captain'];

    /** Roles the owner can hand out: "counter" (a counter manager) exists only in multi-counter companies. */
    private function assignable(): array
    {
        $roles = self::ASSIGNABLE;
        if (Tenant::company()?->kot_enabled) {
            $roles[] = 'chef'; // kitchen login: only the kitchen screen
        }
        if (Tenant::multiCounter()) {
            $roles[] = 'counter';
        }

        return $roles;
    }

    public function index(Request $r)
    {
        return User::inTenant(Tenant::id())->with('roleModel:id,name')->orderBy('name')->get()
            ->map(fn ($u) => $u->only('id', 'name', 'email', 'phone', 'role', 'is_active', 'last_login_at', 'branch_id') + ['branch_ids' => $u->role === 'chef' ? $u->counterIds() : ($u->branch_id ? [(int) $u->branch_id] : [])]);
    }

    public function store(Request $r)
    {
        $plan = $r->attributes->get('plan');
        if ($plan?->max_staff !== null && User::inTenant(Tenant::id())->count() >= $plan->max_staff) {
            return response()->json(['message' => "Your plan allows up to {$plan->max_staff} staff accounts. Please upgrade.", 'code' => 'limit_reached'], 402);
        }

        $data = $r->validate([
            'name' => 'required|string|max:120',
            'email' => 'required|email|unique:users,email',
            'phone' => 'nullable|string|max:20',
            'password' => ['required', 'string', 'min:6', 'max:100'],
            'role' => ['required', Rule::in($this->assignable())],
            // multi-counter: every staff account belongs to exactly one counter
            'branch_id' => Tenant::multiCounter() ? [Rule::requiredIf(fn () => $r->input('role') !== 'chef'), 'nullable', Tenant::exists('branches')] : 'nullable',
            // a chef can cook for several counters
            'branch_ids' => Tenant::multiCounter() && $r->input('role') === 'chef' ? ['required', 'array', 'min:1', 'max:20'] : 'nullable',
            'branch_ids.*' => ['integer', Tenant::exists('branches')],
        ]);

        $u = new User(['name' => $data['name'], 'email' => $data['email'], 'phone' => $data['phone'] ?? null, 'password' => $data['password']]);
        $u->forceFill([
            'company_id' => Tenant::id(),
            'role' => $data['role'],
            'role_id' => Role::where('slug', $data['role'])->value('id'),
            'branch_id' => Tenant::multiCounter() ? ($data['branch_id'] ?? null) : null,
        ])->save();
        if (Tenant::multiCounter() && $data['role'] === 'chef') {
            $u->setCounters($data['branch_ids']);
        }
        AuditLog::record('staff.create', 'user', $u->id, ['role' => $data['role'], 'counter' => $u->branch_id]);

        return response()->json($u->only('id', 'name', 'email', 'role', 'is_active', 'branch_id'), 201);
    }

    public function update(Request $r, int $id)
    {
        $u = $this->find($id);
        abort_if($u->role === 'owner', 403, 'The owner account cannot be modified here.');

        $data = $r->validate([
            'name' => 'sometimes|string|max:120',
            'email' => ['sometimes', 'email', Rule::unique('users', 'email')->ignore($u->id)],
            'phone' => 'nullable|string|max:20',
            'password' => ['nullable', 'string', 'min:6', 'max:100'],
            'role' => ['sometimes', Rule::in($this->assignable())],
            'branch_id' => Tenant::multiCounter() ? ['sometimes', 'nullable', Tenant::exists('branches')] : 'nullable',
            'branch_ids' => 'sometimes|array|min:1|max:20',
            'branch_ids.*' => ['integer', Tenant::exists('branches')],
            'is_active' => 'sometimes|boolean',
        ]);
        if (Tenant::multiCounter()) {
            $finalRole = $data['role'] ?? $u->role;
            $finalBranch = array_key_exists('branch_id', $data) ? $data['branch_id'] : $u->branch_id;
            abort_if($finalRole === 'counter' && ! $finalBranch, 422, 'Choose the counter this login belongs to.');
            if ($finalRole === 'chef' && ! empty($data['branch_ids'])) {
                $u->setCounters($data['branch_ids']); // also saves
                $u->tokens()->delete();
                unset($data['branch_id']);
            }
            if (array_key_exists('branch_id', $data)) {
                $u->branch_id = $data['branch_id'];
                $u->tokens()->delete(); // moved to another counter: sign them in fresh
            }
        }
        unset($data['branch_id']);
        if (empty($data['password'])) {
            unset($data['password']);
        }
        if (isset($data['role'])) {
            if ($u->role === 'chef' && $data['role'] !== 'chef') {
                \Illuminate\Support\Facades\DB::table('branch_user')->where('user_id', $u->id)->delete(); // no longer a chef
            }
            $u->role = $data['role'];
            $u->role_id = Role::where('slug', $data['role'])->value('id');
            unset($data['role']);
        }
        $u->fill($data)->save();
        if (isset($data['is_active']) && ! $data['is_active']) {
            $u->tokens()->delete();
        }
        AuditLog::record('staff.update', 'user', $u->id);

        return $u->only('id', 'name', 'email', 'role', 'is_active', 'branch_id');
    }

    public function destroy(int $id)
    {
        $u = $this->find($id);
        abort_if($u->role === 'owner', 403, 'The owner account cannot be deleted.');
        abort_if($u->id === auth()->id(), 422, 'You cannot delete yourself.');
        $u->tokens()->delete();
        $u->delete();
        AuditLog::record('staff.delete', 'user', $id);

        return response()->noContent();
    }

    public function activity(int $id)
    {
        $u = $this->find($id);

        return \App\Models\AuditLog::where('company_id', Tenant::id())->where('user_id', $u->id)->latest()->limit(50)->get();
    }

    private function find(int $id): User
    {
        return User::inTenant(Tenant::id())->findOrFail($id);
    }
}

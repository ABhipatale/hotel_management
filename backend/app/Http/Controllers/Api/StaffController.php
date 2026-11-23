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
        if (\App\Services\KotService::screen()) {
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
            ->map(fn ($u) => $u->only('id', 'name', 'email', 'phone', 'role', 'is_active', 'last_login_at', 'branch_id') + ['branch_ids' => $u->counterIds()]);
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
            // multi-counter: staff account belongs to one or more counters
            'branch_id' => Tenant::multiCounter() ? ['nullable', Tenant::exists('branches')] : 'nullable',
            'branch_ids' => Tenant::multiCounter() ? ['nullable', 'array', 'min:1', 'max:20'] : 'nullable',
            'branch_ids.*' => ['integer', Tenant::exists('branches')],
        ]);

        $counterIds = [];
        if (Tenant::multiCounter()) {
            if (! empty($data['branch_ids'])) {
                $counterIds = array_values(array_unique(array_map('intval', $data['branch_ids'])));
            } elseif (! empty($data['branch_id'])) {
                $counterIds = [(int) $data['branch_id']];
            } else {
                abort(422, 'Choose the counter this login belongs to.');
            }
        }

        $u = new User(['name' => $data['name'], 'email' => $data['email'], 'phone' => $data['phone'] ?? null, 'password' => $data['password']]);
        $u->forceFill([
            'company_id' => Tenant::id(),
            'role' => $data['role'],
            'role_id' => Role::where('slug', $data['role'])->value('id'),
            'branch_id' => Tenant::multiCounter() ? ($counterIds[0] ?? null) : null,
        ])->save();
        if (Tenant::multiCounter() && ! empty($counterIds)) {
            $u->setCounters($counterIds);
        }
        AuditLog::record('staff.create', 'user', $u->id, ['role' => $data['role'], 'counter' => $u->branch_id]);

        return response()->json($u->only('id', 'name', 'email', 'role', 'is_active', 'branch_id') + ['branch_ids' => $u->counterIds()], 201);
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
            $oldCounters = $u->counterIds();
            sort($oldCounters);

            if (array_key_exists('branch_ids', $data)) {
                $newCounters = ! empty($data['branch_ids']) ? array_values(array_unique(array_map('intval', $data['branch_ids']))) : [];
                abort_if(empty($newCounters), 422, 'Choose the counter this login belongs to.');
                $u->setCounters($newCounters);
            } elseif (array_key_exists('branch_id', $data)) {
                // An older installed app sends only branch_id (its one-counter field) on every save. The login's own main
                // counter = nothing changed: its other counters stay. Another counter = moved there (the old meaning).
                abort_if(! $data['branch_id'], 422, 'Choose the counter this login belongs to.');
                if ((int) $data['branch_id'] !== (int) $u->branch_id) {
                    $u->setCounters([(int) $data['branch_id']]);
                }
            }

            $currentCounters = $u->counterIds();
            sort($currentCounters);
            if ($oldCounters !== $currentCounters) {
                $u->tokens()->delete();
            }
        }
        unset($data['branch_id'], $data['branch_ids']);
        if (empty($data['password'])) {
            unset($data['password']);
        }
        if (isset($data['role'])) {
            $u->role = $data['role'];
            $u->role_id = Role::where('slug', $data['role'])->value('id');
            unset($data['role']);
        }
        $u->fill($data)->save();
        if (isset($data['is_active']) && ! $data['is_active']) {
            $u->tokens()->delete();
        }
        AuditLog::record('staff.update', 'user', $u->id);

        return $u->only('id', 'name', 'email', 'role', 'is_active', 'branch_id') + ['branch_ids' => $u->counterIds()];
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

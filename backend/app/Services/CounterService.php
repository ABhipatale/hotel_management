<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\Company;
use App\Support\Tenant;
use Illuminate\Validation\ValidationException;

/** Counters = branches of a multi-counter company. Shared by the platform admin and the owner. */
class CounterService
{
    public function list(Company $company): array
    {
        return Tenant::as($company, fn () => Branch::orderByDesc('is_default')->orderBy('id')->get()
            ->map(fn (Branch $b) => $b->only('id', 'name', 'address', 'is_default', 'is_active'))->all());
    }

    /** Turn multi-counter on/off. Off is only possible while the company has a single counter (no hidden data). */
    public function setMode(Company $company, bool $multi): void
    {
        Tenant::as($company, function () use ($company, $multi) {
            if (! $multi && Branch::count() > 1) {
                throw ValidationException::withMessages(['multi_counter' => 'This company has more than one counter. Remove the extra counters\' data first - switching to a single counter would hide it.']);
            }
            $company->forceFill(['multi_counter' => $multi])->save();
            if ($multi) {
                // The existing default branch becomes "Counter 1"
                $main = Branch::orderByDesc('is_default')->orderBy('id')->first();
                if ($main && $main->name === 'Main Branch') {
                    $main->update(['name' => 'Counter 1']);
                }
            }
        });
    }

    public function add(Company $company, string $name, ?string $address = null): Branch
    {
        return Tenant::as($company, function () use ($company, $name, $address) {
            if (! $company->multi_counter) {
                throw ValidationException::withMessages(['name' => 'Multiple counters are not switched on for this company.']);
            }
            $this->assertNameFree($name);

            return Branch::create(['name' => $name, 'address' => $address, 'is_default' => ! Branch::exists(), 'is_active' => true]);
        });
    }

    public function update(Company $company, int $id, array $data): Branch
    {
        return Tenant::as($company, function () use ($id, $data) {
            $b = Branch::findOrFail($id);
            if (isset($data['name']) && $data['name'] !== $b->name) {
                $this->assertNameFree($data['name'], $b->id);
            }
            if (array_key_exists('is_active', $data) && ! $data['is_active'] && Branch::where('is_active', true)->where('id', '!=', $b->id)->doesntExist()) {
                throw ValidationException::withMessages(['is_active' => 'At least one counter must stay active.']);
            }
            $b->update(array_intersect_key($data, array_flip(['name', 'address', 'is_active'])));

            return $b;
        });
    }

    private function assertNameFree(string $name, ?int $ignore = null): void
    {
        if (Branch::where('name', $name)->when($ignore, fn ($q) => $q->where('id', '!=', $ignore))->exists()) {
            throw ValidationException::withMessages(['name' => 'A counter with this name already exists.']);
        }
    }
}

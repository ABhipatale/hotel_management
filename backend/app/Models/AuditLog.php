<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AuditLog extends Model
{
    protected $guarded = ['id'];
    protected $casts = ['meta' => 'array'];

    public static function record(string $action, ?string $entity = null, ?int $entityId = null, array $meta = [], ?User $user = null): void
    {
        $user ??= auth()->user();
        static::create([
            'company_id' => $user?->company_id,
            'user_id' => $user?->id,
            'action' => $action,
            'entity' => $entity,
            'entity_id' => $entityId,
            'meta' => $meta ?: null,
            'ip' => request()->ip(),
        ]);
    }
}

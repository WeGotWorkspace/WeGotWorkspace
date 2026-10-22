<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $assembly_id
 * @property string $username
 * @property string|null $media_type
 * @property int $size_bytes
 * @property int $received_bytes
 * @property int $next_index
 * @property int $hashed_bytes
 * @property string|null $hash_state
 * @property string|null $hash_build
 * @property string|null $final_sha256
 * @property string|null $blob_id
 * @property string $status
 * @property Carbon|null $locked_until
 * @property Carbon $expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapBlobAssembly extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_blob_assemblies';

    protected $fillable = [
        'assembly_id',
        'username',
        'media_type',
        'size_bytes',
        'received_bytes',
        'next_index',
        'hashed_bytes',
        'hash_state',
        'hash_build',
        'final_sha256',
        'blob_id',
        'status',
        'locked_until',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'received_bytes' => 'integer',
            'next_index' => 'integer',
            'hashed_bytes' => 'integer',
            'locked_until' => 'datetime',
            'expires_at' => 'datetime',
        ];
    }
}

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
 * @property string $username
 * @property string $blob_id
 * @property string $target_hash
 * @property string $target_key
 * @property string $staging_key
 * @property int $size_bytes
 * @property int $copied_bytes
 * @property Carbon|null $locked_until
 * @property string|null $lease_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapAttachStaging extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_attach_staging';

    protected $fillable = [
        'username',
        'blob_id',
        'target_hash',
        'target_key',
        'staging_key',
        'size_bytes',
        'copied_bytes',
        'locked_until',
        'lease_token',
    ];

    protected function casts(): array
    {
        return [
            'size_bytes' => 'integer',
            'copied_bytes' => 'integer',
            'locked_until' => 'datetime',
        ];
    }
}

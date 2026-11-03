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
 * @property string $node_id
 * @property string $basis
 * @property int $hashed_bytes
 * @property string|null $hash_state
 * @property string|null $hash_build
 * @property Carbon|null $locked_until
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapContentHashJob extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_content_hash_jobs';

    protected $fillable = [
        'node_id',
        'basis',
        'hashed_bytes',
        'hash_state',
        'hash_build',
        'locked_until',
    ];

    protected function casts(): array
    {
        return [
            'hashed_bytes' => 'integer',
            'locked_until' => 'datetime',
        ];
    }
}

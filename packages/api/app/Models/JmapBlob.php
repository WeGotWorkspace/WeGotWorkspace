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
 * @property string|null $media_type
 * @property int $size_bytes
 * @property string $sha256
 * @property Carbon|null $expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapBlob extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_blobs';

    protected $fillable = [
        'username',
        'blob_id',
        'media_type',
        'size_bytes',
        'sha256',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
        ];
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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

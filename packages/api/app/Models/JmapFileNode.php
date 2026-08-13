<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class JmapFileNode extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_file_nodes';

    protected $fillable = [
        'node_id',
        'storage_key',
        'parent_node_id',
        'name',
        'is_dir',
        'size_bytes',
        'content_sha256',
        'created_seq',
        'change_seq',
        'deleted_at',
    ];

    protected function casts(): array
    {
        return [
            'is_dir' => 'boolean',
            'deleted_at' => 'datetime',
        ];
    }
}

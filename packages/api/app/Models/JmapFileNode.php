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
 * @property string $storage_key
 * @property string|null $parent_node_id
 * @property string $name
 * @property bool $is_dir
 * @property int|null $size_bytes
 * @property string|null $content_sha256
 * @property int $created_seq
 * @property int $change_seq
 * @property Carbon|null $deleted_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
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

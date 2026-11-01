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
 * @property int $part_index
 * @property string $blob_id
 * @property int $size_bytes
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class JmapBlobAssemblyPart extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_blob_assembly_parts';

    protected $fillable = [
        'assembly_id',
        'part_index',
        'blob_id',
        'size_bytes',
    ];

    protected function casts(): array
    {
        return [
            'part_index' => 'integer',
            'size_bytes' => 'integer',
        ];
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $root_hash SHA-256 of root_key (the unique key)
 * @property string $root_key Drive root storage key (`users/x`, `groups/y`, or a share root)
 * @property int $marker
 */
final class JmapFileNodeRootMarker extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_file_node_root_markers';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['root_hash', 'root_key', 'marker'];
}

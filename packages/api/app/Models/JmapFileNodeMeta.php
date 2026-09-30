<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property int $seq
 * @property int $pruned_seq
 */
final class JmapFileNodeMeta extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_file_node_meta';

    public $timestamps = false;

    protected $fillable = ['seq', 'pruned_seq'];
}

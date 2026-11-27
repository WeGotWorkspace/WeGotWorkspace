<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $node_id
 * @property string $tag
 */
final class JmapFileNodeTag extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_file_node_tags';

    public $timestamps = false;

    protected $fillable = ['node_id', 'tag'];
}

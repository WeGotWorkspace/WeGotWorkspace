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
 * @property string $node_id FileNode id that moved
 * @property string $from_key storage key the node left
 * @property int $seq change sequence of the move
 * @property Carbon|null $created_at
 */
final class JmapFileNodeDeparture extends Model
{
    use UsesWgwConnection;

    public const UPDATED_AT = null;

    protected $table = 'jmap_file_node_departures';

    /** @var list<string> */
    protected $fillable = ['node_id', 'from_key', 'seq'];
}

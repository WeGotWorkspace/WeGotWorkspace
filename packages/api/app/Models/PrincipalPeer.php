<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $room
 * @property string $peer_id
 * @property string $name
 * @property string $owner_user
 * @property int $seen_at
 * @property string $caps
 * @property string $net
 */
final class PrincipalPeer extends Model
{
    use UsesWgwConnection;

    protected $table = 'principal_peers';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'room',
        'peer_id',
        'name',
        'owner_user',
        'caps',
        'net',
        'seen_at',
    ];
}

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
 * @property int $admitted
 * @property string $browser_id
 */
final class MeetPeer extends Model
{
    use UsesWgwConnection;

    protected $table = 'meet_peers';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'room',
        'peer_id',
        'name',
        'owner_user',
        'browser_id',
        'seen_at',
    ];
}

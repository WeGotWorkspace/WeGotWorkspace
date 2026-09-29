<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Per-user read position in a chat channel: (last_read_ts, last_read_uid)
 * mirrors the (created_ts, uid) message ordering; the ULID is the tiebreak
 * for equal timestamps, never the sole comparator.
 *
 * @property int $id
 * @property string $username
 * @property int $calendarid
 * @property int $last_read_ts
 * @property string $last_read_uid
 */
final class ChatReadMarker extends Model
{
    use UsesWgwConnection;

    protected $table = 'chat_read_markers';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'calendarid',
        'last_read_ts',
        'last_read_uid',
    ];
}

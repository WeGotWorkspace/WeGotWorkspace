<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Chat channel side table keyed by the CalDAV calendar id — kind
 * (channel|meeting|dm), topic, the meet_reservations room code for meeting
 * channels, and default_for_group (the group slug when this is the group's
 * auto-provisioned default channel; unique per group). Rows cascade away with
 * the calendar.
 */
final class ChatChannelMeta extends Model
{
    use UsesWgwConnection;

    public const KIND_CHANNEL = 'channel';

    public const KIND_MEETING = 'meeting';

    public const KIND_DM = 'dm';

    /** @return list<string> */
    public static function kinds(): array
    {
        return [self::KIND_CHANNEL, self::KIND_MEETING, self::KIND_DM];
    }

    protected $table = 'chat_channel_meta';

    protected $primaryKey = 'calendarid';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'calendarid',
        'kind',
        'topic',
        'room_code',
        'default_for_group',
    ];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }
}

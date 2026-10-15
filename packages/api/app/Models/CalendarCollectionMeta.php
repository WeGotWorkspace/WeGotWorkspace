<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Collection-ownership side table keyed by the CalDAV calendar id: which app a
 * collection belongs to. Rows cascade away with the calendar.
 *
 * Layering: this answers "which app owns this collection". ChatChannelMeta
 * answers "what sort of channel is this" (channel|meeting|dm). Keep both.
 *
 * @property int $calendarid
 * @property string $kind
 */
final class CalendarCollectionMeta extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_collection_meta';

    protected $primaryKey = 'calendarid';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['calendarid', 'kind'];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }
}

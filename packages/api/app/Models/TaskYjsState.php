<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Live-text state of one task (#2208). `state` is raw Yjs bytes with no cast:
 * a cast would corrupt the blob.
 *
 * @property int $id
 * @property int $calendar_object_id
 * @property string $vtodo_uid
 * @property string $state
 * @property string $object_etag
 * @property string $content_etag
 */
final class TaskYjsState extends Model
{
    use UsesWgwConnection;

    protected $table = 'task_yjs_state';

    /** @var list<string> */
    protected $fillable = [
        'calendar_object_id',
        'vtodo_uid',
        'state',
        'object_etag',
        'content_etag',
    ];

    /** @return BelongsTo<CalendarObject, $this> */
    public function calendarObject(): BelongsTo
    {
        return $this->belongsTo(CalendarObject::class, 'calendar_object_id');
    }
}

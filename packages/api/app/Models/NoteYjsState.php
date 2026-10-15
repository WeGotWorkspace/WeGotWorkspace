<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * `state` is raw Yjs bytes. It has no cast: a cast would corrupt the blob.
 *
 * @property int $id
 * @property int $calendar_object_id
 * @property string $note_uid
 * @property string $state
 * @property string $object_etag
 */
final class NoteYjsState extends Model
{
    use UsesWgwConnection;

    protected $table = 'note_yjs_state';

    /** @var list<string> */
    protected $fillable = [
        'calendar_object_id',
        'note_uid',
        'state',
        'object_etag',
    ];

    /** @return BelongsTo<CalendarObject, $this> */
    public function calendarObject(): BelongsTo
    {
        return $this->belongsTo(CalendarObject::class, 'calendar_object_id');
    }
}

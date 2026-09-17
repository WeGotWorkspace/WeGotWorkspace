<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

final class NoteStar extends Model
{
    use UsesWgwConnection;

    protected $table = 'note_stars';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'calendar_object_id',
        'note_uid',
    ];

    /** @return BelongsTo<CalendarObject, $this> */
    public function calendarObject(): BelongsTo
    {
        return $this->belongsTo(CalendarObject::class, 'calendar_object_id');
    }
}

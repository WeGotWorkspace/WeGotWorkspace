<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class JmapCalendarEventState extends Model
{
    use UsesWgwConnection;

    protected $table = 'jmap_calendar_event_states';

    protected $fillable = [
        'username',
        'event_id',
        'calendar_uri',
        'object_uri',
        'state_token',
        'etag',
    ];
}

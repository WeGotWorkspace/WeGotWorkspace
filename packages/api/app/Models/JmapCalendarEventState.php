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
 * @property string $username
 * @property string $event_id
 * @property string $calendar_uri
 * @property string $object_uri
 * @property string $state_token
 * @property string|null $etag
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
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

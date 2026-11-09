<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * The primary key is (principal_uri, calendarid); write through query builders.
 *
 * @property string $principal_uri
 * @property int $calendarid
 * @property bool $include
 * @property string $detail
 * @property Carbon $updated_at
 */
final class CalendarAvailabilityPref extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_availability_prefs';

    public $incrementing = false;

    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    /** @var list<string> */
    protected $fillable = [
        'principal_uri',
        'calendarid',
        'include',
        'detail',
        'updated_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'calendarid' => 'integer',
        'include' => 'boolean',
        'updated_at' => 'datetime',
    ];
}

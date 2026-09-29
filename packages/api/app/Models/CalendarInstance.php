<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * Nullability follows Sabre's MySQL and SQLite bundles: nullable when either allows NULL.
 *
 * @property int $id
 * @property int $calendarid
 * @property string|null $principaluri
 * @property int $access
 * @property string|null $displayname
 * @property string|null $uri
 * @property string|null $description
 * @property int|null $calendarorder
 * @property string|null $calendarcolor
 * @property string|null $timezone
 * @property int|null $transparent
 * @property string|null $share_href
 * @property string|null $share_displayname
 * @property int|null $share_invitestatus
 */
final class CalendarInstance extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendarinstances';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'calendarid',
        'principaluri',
        'access',
        'displayname',
        'uri',
        'description',
        'calendarorder',
        'calendarcolor',
        'timezone',
        'transparent',
        'share_href',
        'share_displayname',
        'share_invitestatus',
    ];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }

    /** @return HasMany<CalendarObject, $this> */
    public function objects(): HasMany
    {
        return $this->hasMany(CalendarObject::class, 'calendarid', 'calendarid');
    }
}

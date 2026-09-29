<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $calendardata
 * @property string $uri
 * @property int $calendarid
 * @property int $lastmodified
 * @property string $etag
 * @property int $size
 * @property string|null $componenttype
 * @property int|null $firstoccurence
 * @property int|null $lastoccurence
 * @property string|null $uid
 */
final class CalendarObject extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendarobjects';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'calendardata',
        'uri',
        'calendarid',
        'lastmodified',
        'etag',
        'size',
        'componenttype',
        'firstoccurence',
        'lastoccurence',
        'uid',
    ];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * Nullability follows Sabre's MySQL and SQLite bundles: nullable when either allows NULL.
 *
 * @property int $id
 * @property string|null $uri
 * @property int $synctoken
 * @property int $calendarid
 * @property int $operation
 */
final class CalendarChange extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendarchanges';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'uri',
        'synctoken',
        'calendarid',
        'operation',
    ];

    /** @return BelongsTo<Calendar, $this> */
    public function calendar(): BelongsTo
    {
        return $this->belongsTo(Calendar::class, 'calendarid');
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $principaluri
 * @property string|null $calendardata
 * @property string $uri
 * @property int|null $lastmodified
 * @property string $etag
 * @property int $size
 */
final class SchedulingObject extends Model
{
    use UsesWgwConnection;

    protected $table = 'schedulingobjects';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'principaluri',
        'calendardata',
        'uri',
        'lastmodified',
        'etag',
        'size',
    ];
}

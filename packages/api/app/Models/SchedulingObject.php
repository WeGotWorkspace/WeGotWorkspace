<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 * Nullability follows Sabre's MySQL and SQLite bundles: nullable when either allows NULL.
 *
 * @property int $id
 * @property string|null $principaluri
 * @property string|null $calendardata
 * @property string|null $uri
 * @property int|null $lastmodified
 * @property string|null $etag
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

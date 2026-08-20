<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

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

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class CalendarShareDismissal extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_share_dismissals';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'calendarid',
        'dismissed_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'dismissed_at' => 'datetime',
        'calendarid' => 'integer',
    ];
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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

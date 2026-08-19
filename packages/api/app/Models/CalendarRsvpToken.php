<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class CalendarRsvpToken extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_rsvp_tokens';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'token',
        'event_uid',
        'attendee_email',
        'organizer_username',
        'expires_at',
        'used_partstat',
    ];
}

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
        'token_hash',
        'event_uid',
        'attendee_email',
        'organizer_username',
        'expires_at',
        'used_partstat',
    ];

    public static function hashRaw(string $token): string
    {
        return hash('sha256', strtolower(trim($token)));
    }

    public static function findByRawToken(string $token): ?self
    {
        $hash = self::hashRaw($token);
        $row = self::query()->where('token_hash', $hash)->first();
        if ($row === null) {
            return null;
        }
        if (! hash_equals((string) $row->token_hash, $hash)) {
            return null;
        }

        return $row;
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property int $id
 * @property string $token_hash
 * @property string $event_uid
 * @property string $attendee_email
 * @property string $organizer_username
 * @property int $expires_at
 * @property string|null $used_partstat
 */
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

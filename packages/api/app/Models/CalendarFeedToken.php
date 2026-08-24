<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

final class CalendarFeedToken extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_feed_tokens';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'token_hash',
        'token_cipher',
        'owner_username',
        'calendar_uri',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'token_cipher' => 'encrypted',
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

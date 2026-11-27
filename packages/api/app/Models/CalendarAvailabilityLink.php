<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * The public availability link of one person (#2405). A row means the link is
 * on. `token_hash` is SHA-256 of the lowercased token (same as published
 * calendar feeds); `token_cipher` is the token encrypted with the app key so
 * the owner can read the link again.
 *
 * @property string $principal_uri
 * @property string $token_hash
 * @property string $token_cipher
 * @property string $created_at
 * @property string|null $rotated_at
 */
final class CalendarAvailabilityLink extends Model
{
    use UsesWgwConnection;

    protected $table = 'calendar_availability_links';

    protected $primaryKey = 'principal_uri';

    public $incrementing = false;

    protected $keyType = 'string';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'principal_uri',
        'token_hash',
        'token_cipher',
        'created_at',
        'rotated_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'token_cipher' => 'encrypted',
    ];

    public static function findByRawToken(string $token): ?self
    {
        $hash = CalendarFeedToken::hashRaw($token);
        $row = self::query()->where('token_hash', $hash)->first();

        return $row !== null && hash_equals((string) $row->token_hash, $hash) ? $row : null;
    }
}

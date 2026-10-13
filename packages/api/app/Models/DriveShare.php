<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $path
 * @property string $owner_username
 * @property string $kind
 * @property string $default_access
 * @property string|null $public_token
 * @property string|null $public_token_hash
 * @property string|null $public_token_cipher Read via displayedPublicToken(), not this property. The encrypted cast throws when APP_KEY cannot decrypt; the helper returns null.
 * @property string|null $password_hash
 * @property Carbon|null $expires_at
 * @property Carbon|null $revoked_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class DriveShare extends Model
{
    use UsesWgwConnection;

    protected $table = 'drive_shares';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'path',
        'owner_username',
        'kind',
        'default_access',
        'public_token',
        'public_token_hash',
        'public_token_cipher',
        'password_hash',
        'expires_at',
        'revoked_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'public_token_cipher' => 'encrypted',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    public static function hashPublicToken(string $token): string
    {
        return hash('sha256', strtolower(trim($token)));
    }

    /**
     * Public links stay until revoked (or until the share's own expires_at).
     * The raw token is encrypted so the owner UI can redisplay it.
     */
    public function storePublicToken(?string $token): void
    {
        $this->public_token = null;
        if ($token === null || trim($token) === '') {
            $this->public_token_hash = null;
            $this->public_token_cipher = null;

            return;
        }

        $this->public_token_hash = self::hashPublicToken($token);
        $this->public_token_cipher = $token;
    }

    public function displayedPublicToken(): ?string
    {
        $cipher = $this->attributes['public_token_cipher'] ?? null;
        if (! is_string($cipher) || $cipher === '') {
            return null;
        }

        try {
            $token = Crypt::decryptString($cipher);
        } catch (\Throwable) {
            // A rotated APP_KEY cannot decrypt this row. Omit the link instead of failing the share list.
            return null;
        }

        return $token === '' ? null : $token;
    }

    /** @return HasMany<DriveShareGrant, $this> */
    public function grants(): HasMany
    {
        return $this->hasMany(DriveShareGrant::class, 'share_id');
    }

    /** @return HasMany<DriveShareSession, $this> */
    public function sessions(): HasMany
    {
        return $this->hasMany(DriveShareSession::class, 'share_id');
    }
}

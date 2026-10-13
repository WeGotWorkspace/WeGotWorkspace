<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $share_id
 * @property string $grantee_type
 * @property string|null $grantee_user
 * @property string|null $grantee_email
 * @property string|null $grantee_group
 * @property string $access
 * @property string $status
 * @property string|null $invite_token
 * @property string|null $invite_token_hash
 * @property string|null $invite_token_cipher Read via displayedInviteToken(), not this property. The encrypted cast throws when APP_KEY cannot decrypt; the helper returns null.
 * @property Carbon|null $invite_expires_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class DriveShareGrant extends Model
{
    use UsesWgwConnection;

    /** Email invites last this many days. Public links stay until revoked. */
    public const INVITE_TTL_DAYS = 14;

    protected $table = 'drive_share_grants';

    public $incrementing = false;

    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = [
        'id',
        'share_id',
        'grantee_type',
        'grantee_user',
        'grantee_email',
        'grantee_group',
        'access',
        'status',
        'invite_token',
        'invite_token_hash',
        'invite_token_cipher',
        'invite_expires_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'invite_token_cipher' => 'encrypted',
        'invite_expires_at' => 'datetime',
    ];

    public static function hashInviteToken(string $token): string
    {
        // Same normalization as DriveShare::hashPublicToken and CalendarFeedToken::hashRaw.
        return hash('sha256', strtolower(trim($token)));
    }

    public function issueInviteToken(): void
    {
        $raw = bin2hex(random_bytes(16));
        $this->invite_token = null;
        $this->invite_token_hash = self::hashInviteToken($raw);
        $this->invite_token_cipher = $raw;
        $this->invite_expires_at = Carbon::now()->addDays(self::INVITE_TTL_DAYS);
    }

    public function displayedInviteToken(): ?string
    {
        $cipher = $this->attributes['invite_token_cipher'] ?? null;
        if (! is_string($cipher) || $cipher === '') {
            return null;
        }

        try {
            $token = Crypt::decryptString($cipher);
        } catch (\Throwable) {
            // A rotated APP_KEY cannot decrypt this row. The caller must not treat that as a token.
            return null;
        }

        return $token === '' ? null : $token;
    }

    /** @return BelongsTo<DriveShare, $this> */
    public function share(): BelongsTo
    {
        return $this->belongsTo(DriveShare::class, 'share_id');
    }
}

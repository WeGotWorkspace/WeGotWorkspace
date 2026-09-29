<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string $path
 * @property string $owner_username
 * @property string $kind
 * @property string $default_access
 * @property string|null $public_token
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
        'password_hash',
        'expires_at',
        'revoked_at',
    ];

    /** @var array<string, string> */
    protected $casts = [
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

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

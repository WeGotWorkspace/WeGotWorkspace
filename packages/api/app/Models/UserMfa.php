<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The authenticator of one user (#2273). A row without `enabled_at` is a setup
 * in progress and does not count as on. `totp_secret` is encrypted with
 * APP_KEY; only `UserMfaService::readSecret()` reads it.
 *
 * @property int $id
 * @property string $username
 * @property string $totp_secret
 * @property Carbon|null $enabled_at
 * @property int|null $last_used_step
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class UserMfa extends Model
{
    use UsesWgwConnection;

    protected $table = 'user_mfa';

    /** @var list<string> */
    protected $fillable = ['username', 'totp_secret', 'enabled_at', 'last_used_step'];

    /** @var list<string> */
    protected $hidden = ['totp_secret'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'totp_secret' => 'encrypted',
            'enabled_at' => 'datetime',
            'last_used_step' => 'integer',
        ];
    }
}

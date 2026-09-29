<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * TOTP enrollment for one user.
 *
 * totp_secret is Laravel-encrypted. A row may exist before enabled_at when
 * enrollment is pending or a suggestion has been snoozed.
 *
 * @property int $id
 * @property string $username
 * @property string|null $totp_secret
 * @property Carbon|null $enabled_at
 * @property int|null $last_used_step
 * @property Carbon|null $suggest_snoozed_until
 */
final class UserMfa extends Model
{
    use UsesWgwConnection;

    protected $table = 'wgw_user_mfa';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'totp_secret',
        'enabled_at',
        'last_used_step',
        'suggest_snoozed_until',
    ];

    /** @var list<string> */
    protected $hidden = [
        'totp_secret',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'totp_secret' => 'encrypted',
            'enabled_at' => 'datetime',
            'last_used_step' => 'integer',
            'suggest_snoozed_until' => 'datetime',
        ];
    }
}

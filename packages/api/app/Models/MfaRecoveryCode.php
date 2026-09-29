<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Single-use recovery code. Only the SHA-256 of the normalized code is stored.
 *
 * @property int $id
 * @property string $username
 * @property string $code_hash
 * @property Carbon|null $used_at
 * @property Carbon $created_at
 */
final class MfaRecoveryCode extends Model
{
    use UsesWgwConnection;

    protected $table = 'wgw_mfa_recovery_codes';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'code_hash',
        'used_at',
        'created_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'used_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}

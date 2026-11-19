<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * One recovery code of a user, stored as sha256 only (#2273).
 *
 * @property int $id
 * @property string $username
 * @property string $code_hash
 * @property Carbon|null $created_at
 * @property Carbon|null $used_at
 */
final class MfaRecoveryCode extends Model
{
    use UsesWgwConnection;

    protected $table = 'mfa_recovery_codes';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['username', 'code_hash', 'created_at', 'used_at'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return ['created_at' => 'datetime', 'used_at' => 'datetime'];
    }
}

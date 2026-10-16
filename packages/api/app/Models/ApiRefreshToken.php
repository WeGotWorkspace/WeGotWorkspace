<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Crypt;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * successor_token is read and written only through the seal/open helpers.
 *
 * @property string $token_hash
 * @property string $username
 * @property string $role
 * @property int $expires_at
 * @property int $revoked
 * @property int $created_at
 * @property string|null $family_id
 * @property int|null $rotated_at
 * @property string|null $successor_hash
 * @property string|null $successor_token
 */
final class ApiRefreshToken extends Model
{
    use UsesWgwConnection;

    protected $table = 'api_refresh_tokens';

    protected $primaryKey = 'token_hash';

    protected $keyType = 'string';

    public $incrementing = false;

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'token_hash',
        'username',
        'role',
        'expires_at',
        'revoked',
        'created_at',
        'family_id',
        'rotated_at',
        'successor_hash',
    ];

    /** @var list<string> */
    protected $hidden = [
        'successor_token',
    ];

    public static function sealSuccessorToken(string $token): string
    {
        return Crypt::encryptString($token);
    }

    public function openSuccessorToken(): ?string
    {
        $cipher = $this->successor_token;
        if (! is_string($cipher) || $cipher === '') {
            return null;
        }

        try {
            $token = Crypt::decryptString($cipher);
        } catch (DecryptException) {
            return null;
        }

        return $token === '' ? null : $token;
    }
}

<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $token_hash
 * @property string $username
 * @property string $role
 * @property int $expires_at
 * @property int $revoked
 * @property int $created_at
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
    ];
}

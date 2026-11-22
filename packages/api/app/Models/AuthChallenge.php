<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The step between a correct password and a code (#2273). Only the sha256 of
 * the challenge id is stored. `kind` is `login` or `replace`; `client` is `spa`
 * or `oauth`. `pending_secret` holds the new secret of a replacement.
 *
 * @property int $id
 * @property string $id_hash
 * @property string $username
 * @property string $kind
 * @property string $client
 * @property string|null $pending_secret
 * @property int $attempts
 * @property Carbon $expires_at
 * @property Carbon|null $consumed_at
 * @property Carbon|null $created_at
 */
final class AuthChallenge extends Model
{
    use UsesWgwConnection;

    public const string KIND_LOGIN = 'login';

    public const string KIND_REPLACE = 'replace';

    public const string CLIENT_SPA = 'spa';

    public const string CLIENT_OAUTH = 'oauth';

    protected $table = 'auth_challenges';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = ['id_hash', 'username', 'kind', 'client', 'pending_secret', 'attempts', 'expires_at', 'consumed_at', 'created_at'];

    /** @var list<string> */
    protected $hidden = ['pending_secret'];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'pending_secret' => 'encrypted',
            'attempts' => 'integer',
            'expires_at' => 'datetime',
            'consumed_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}

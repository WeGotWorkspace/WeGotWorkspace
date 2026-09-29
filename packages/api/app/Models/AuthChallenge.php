<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Short-lived login challenge. The client holds the plaintext id; only sha256 is stored.
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
 * @property Carbon $created_at
 */
final class AuthChallenge extends Model
{
    use UsesWgwConnection;

    protected $table = 'wgw_auth_challenges';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'id_hash',
        'username',
        'kind',
        'client',
        'pending_secret',
        'attempts',
        'expires_at',
        'consumed_at',
        'created_at',
    ];

    /** @var list<string> */
    protected $hidden = [
        'pending_secret',
        'id_hash',
    ];

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

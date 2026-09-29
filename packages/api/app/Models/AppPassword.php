<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Named DAV/Meet app password. Only the SHA-256 of the normalized secret is stored.
 *
 * @property int $id
 * @property string $username
 * @property string $name
 * @property string $token_hash
 * @property Carbon $created_at
 * @property Carbon|null $last_used_at
 * @property string|null $last_used_client
 * @property Carbon|null $revoked_at
 */
final class AppPassword extends Model
{
    use UsesWgwConnection;

    protected $table = 'wgw_app_passwords';

    public $timestamps = false;

    /** @var list<string> */
    protected $fillable = [
        'username',
        'name',
        'token_hash',
        'created_at',
        'last_used_at',
        'last_used_client',
        'revoked_at',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }
}

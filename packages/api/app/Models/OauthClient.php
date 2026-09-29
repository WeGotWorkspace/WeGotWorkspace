<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Illuminate\Support\Carbon;
use Laravel\Passport\Client;

/**
 * Columns on the wgw table. Larastan does not see `$this->wgw()` migrations.
 *
 * @property string $id
 * @property string|null $owner_type
 * @property int|null $owner_id
 * @property string $name
 * @property string|null $secret
 * @property string|null $provider
 * @property array<string, mixed> $redirect_uris
 * @property array<string, mixed> $grant_types
 * @property array<string, mixed>|null $scopes
 * @property bool $revoked
 * @property string|null $cimd_url
 * @property string|null $cimd_origin
 * @property Carbon|null $cimd_fetched_at
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
final class OauthClient extends Client
{
    use UsesWgwConnection;

    /** @var array<string, string> */
    protected $casts = [
        'grant_types' => 'array',
        'scopes' => 'array',
        'redirect_uris' => 'array',
        'personal_access_client' => 'bool',
        'password_client' => 'bool',
        'revoked' => 'bool',
        'cimd_fetched_at' => 'datetime',
    ];
}

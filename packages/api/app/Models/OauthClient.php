<?php

declare(strict_types=1);

namespace App\Models;

use App\Models\Concerns\UsesWgwConnection;
use Laravel\Passport\Client;

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

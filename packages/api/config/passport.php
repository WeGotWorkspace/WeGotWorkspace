<?php

declare(strict_types=1);

return [
    'guard' => 'web',
    'middleware' => [],
    'middleware_groups' => [
        'web' => ['web'],
        'api' => ['api'],
    ],
    'private_key' => env('PASSPORT_PRIVATE_KEY'),
    'public_key' => env('PASSPORT_PUBLIC_KEY'),
    'connection' => 'wgw',
    'password_grant_enabled' => false,
    'password_grant_client' => [],
    'personal_access_client' => [
        'id' => env('PASSPORT_PERSONAL_ACCESS_CLIENT_ID'),
        'secret' => env('PASSPORT_PERSONAL_ACCESS_CLIENT_SECRET'),
        'name' => env('PASSPORT_PERSONAL_ACCESS_CLIENT_NAME', 'Laravel Personal Access Client'),
    ],
];

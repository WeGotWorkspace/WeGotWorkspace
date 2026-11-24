<?php

declare(strict_types=1);

/*
|--------------------------------------------------------------------------
| Cross-origin requests to the REST API
|--------------------------------------------------------------------------
|
| The SPA is served from the same origin as the API, and the dev server
| proxies `/api`, so the REST API allows no other origin. Laravel's default
| (`*` with every header) let any site read the API and send a bearer
| token it holds.
|
| The MCP routes keep their own open CORS headers (McpCors): browser MCP
| clients run on other origins and sign in with OAuth.
|
*/

return [
    'paths' => ['api/*'],
    'allowed_methods' => [],
    'allowed_origins' => [],
    'allowed_origins_patterns' => [],
    'allowed_headers' => [],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];

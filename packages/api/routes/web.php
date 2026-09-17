<?php

declare(strict_types=1);

use App\Http\Controllers\Front\WgwFrontController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| UI shells + WebDAV (non-JSON front door)
|--------------------------------------------------------------------------
|
| All browser and WebDAV traffic is handled by Laravel. REST stays on
| routes/api.php (prefix api/v1).
|
*/

/** @var list<string> */
$wgwFrontMethods = [
    'GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS',
    'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK', 'REPORT', 'SEARCH',
];

// When Apache serves Laravel via Alias /api → public/index.php, PATH_INFO is relative
// to that script (e.g. /v1/health), not /api/v1/health — exclude versioned API segments too.
// MCP OAuth discovery (RFC 8414 / 9728) is at the origin root: /.well-known/oauth-*.
// Deployments that mount Laravel only under a path must rewrite those two paths to Laravel
// (see docs/mcp-connect.md). /mcp and /oauth/* must not fall through to SabreDAV.
Route::match($wgwFrontMethods, '/{path?}', WgwFrontController::class)
    ->where('path', '(?!api(?:/|$)|v\d+(?:/|$)|mcp(?:/|$)|oauth(?:/|$)|\.well-known/oauth-(?:authorization-server|protected-resource)(?:/|$)).*')
    ->name('wgw.front');

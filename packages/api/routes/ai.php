<?php

declare(strict_types=1);

use App\Http\Controllers\Mcp\OAuthMetadataController;
use App\Http\Controllers\Mcp\OAuthRegisterController;
use App\Http\Controllers\Mcp\OAuthSessionController;
use App\Http\Middleware\RejectSpaJwtOnMcp;
use App\Http\Middleware\TouchMcpSession;
use App\Mcp\Servers\WorkspaceServer;
use Illuminate\Support\Facades\Route;
use Laravel\Mcp\Facades\Mcp;

Route::get('/.well-known/oauth-authorization-server', [OAuthMetadataController::class, 'authorizationServer'])
    ->name('mcp.oauth.authorization-server');
Route::get('/.well-known/oauth-authorization-server/{path}', [OAuthMetadataController::class, 'authorizationServer'])
    ->where('path', '.*');
Route::get('/.well-known/oauth-protected-resource', [OAuthMetadataController::class, 'protectedResource'])
    ->name('mcp.oauth.protected-resource');
Route::get('/.well-known/oauth-protected-resource/{path}', [OAuthMetadataController::class, 'protectedResource'])
    ->where('path', '.*')
    ->name('mcp.oauth.protected-resource.nested');

Route::get('/oauth/session', [OAuthSessionController::class, 'show'])
    ->middleware('web')
    ->name('login');
Route::post('/oauth/session', [OAuthSessionController::class, 'store'])
    ->middleware('web')
    ->name('mcp.oauth.session');

Route::post('/oauth/register', OAuthRegisterController::class)
    ->middleware('throttle:10,1');

Mcp::web('/mcp', WorkspaceServer::class)->middleware([
    RejectSpaJwtOnMcp::class,
    'auth:api',
    TouchMcpSession::class,
]);

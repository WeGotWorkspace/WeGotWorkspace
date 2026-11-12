<?php

declare(strict_types=1);

use App\Exceptions\RendersApiError;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Middleware\BindMcpPublicOrigin;
use App\Http\Middleware\CompletePendingSchemaMigrations;
use App\Http\Middleware\EnsureCalendarsEnabled;
use App\Http\Middleware\EnsureContactsEnabled;
use App\Http\Middleware\EnsureMcpEnabled;
use App\Http\Middleware\EnsureTasksEnabled;
use App\Http\Middleware\ExposeNotifiedRecipients;
use App\Http\Middleware\FilterMcpConsentScopes;
use App\Http\Middleware\McpCors;
use App\Http\Middleware\ProtectMcpConsent;
use App\Http\Middleware\RejectSpaJwtOnMcp;
use App\Http\Middleware\ReplayMcpConsentDecision;
use App\Http\Middleware\RequireGuestSession;
use App\Http\Middleware\RequireWgwRole;
use App\Http\Middleware\ResolveCimdClient;
use App\Http\Middleware\WgwSecurityHeaders;
use App\Http\RateLimiting\GuestUploadRateLimiters;
use App\Http\RateLimiting\JmapPushRateLimiters;
use App\Http\RateLimiting\WgwApiRateLimiters;
use App\Http\Support\WgwOversizedPost;
use App\Services\Auth\RefreshCookie;
use App\Services\Mcp\McpPublicOrigin;
use App\Support\PublicAppUrl;
use App\Support\WgwEnvLocation;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Middleware\ValidatePostSize;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Illuminate\Routing\Middleware\ThrottleRequestsWithRedis;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;

$app = Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: 'api/v1',
        then: function (): void {
            require __DIR__.'/../routes/docs.php';
            require __DIR__.'/../routes/ai.php';
        },
    )
    ->withSchedule(function (Schedule $schedule): void {
        $schedule->command('wgw:notify:due-alarms')->everyMinute()->withoutOverlapping();
        $schedule->command('wgw:notify:vapid-sweep')->everyMinute()->withoutOverlapping();
        $schedule->command('wgw:rtc:prune')->hourly()->withoutOverlapping();
        $schedule->command('wgw:availability:prune-cache')->hourly()->withoutOverlapping();
    })
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->encryptCookies(except: [
            'sabre_ui_auth',
            RefreshCookie::NAME,
        ]);
        $middleware->alias([
            'wgw.auth' => AuthenticateWgwApi::class,
            'wgw.role' => RequireWgwRole::class,
            'wgw.guest' => RequireGuestSession::class,
            'wgw.contacts' => EnsureContactsEnabled::class,
            'wgw.calendars' => EnsureCalendarsEnabled::class,
            'wgw.tasks' => EnsureTasksEnabled::class,
            'mcp.enabled' => EnsureMcpEnabled::class,
            'mcp.cimd' => ResolveCimdClient::class,
            'mcp.consent' => ProtectMcpConsent::class,
            'mcp.consent.scopes' => FilterMcpConsentScopes::class,
            'mcp.reject-spa-jwt' => RejectSpaJwtOnMcp::class,
        ]);
        $middleware->appendToGroup('web', [
            WgwSecurityHeaders::class,
            ProtectMcpConsent::class,
            ReplayMcpConsentDecision::class,
            FilterMcpConsentScopes::class,
        ]);
        $middleware->appendToGroup('api', [
            WgwSecurityHeaders::class,
            // Names the users the caller's write notified, for a mesh check-now (#1662).
            ExposeNotifiedRecipients::class,
        ]);
        // SDP must keep its trailing CRLF. TrimStrings would strip it on the way in,
        // and Chrome then refuses the Firefox offer (`invalid sdp line`).
        $middleware->trimStrings(except: [
            'payload.sdp',
        ]);
        // public/index.php refuses an oversized body before Laravel starts, with the
        // WebDAV PUT exception; this copy of the check would refuse that PUT again.
        $middleware->remove(ValidatePostSize::class);
        $middleware->trustHosts(at: fn (): array => PublicAppUrl::trustedHostPatterns(), subdomains: false);
        $middleware->trustProxies(at: ['127.0.0.1', '::1', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16']);
        // An older release's updater can swap the files and then fail to run
        // the new migrations in its own process (#1076). Finish them before
        // any route reads the schema.
        $middleware->prepend(CompletePendingSchemaMigrations::class);
        $middleware->append(BindMcpPublicOrigin::class);
        $middleware->append(McpCors::class);
        $middleware->append(EnsureMcpEnabled::class);
        $middleware->append(ResolveCimdClient::class);
        $middleware->validateCsrfTokens(except: [
            '*',
        ]);
        // ThrottleRequests is sorted ahead of route middleware. Keep wgw.auth
        // in front of it so the limiter sees the principal, not the client address.
        $middleware->prependToPriorityList(
            before: [
                ThrottleRequests::class,
                ThrottleRequestsWithRedis::class,
            ],
            prepend: AuthenticateWgwApi::class,
        );
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        // The one render hook for API errors (#1646): ApiHttpException and the
        // realtime DomainResponseException family. Contract: .agents/skills/api/rest-design.md.
        $exceptions->render(function (RendersApiError $e) {
            return response()->json($e->apiErrorBody(), $e->apiErrorStatus(), $e->apiErrorHeaders());
        });
        $exceptions->render(function (ValidationException $e) {
            $message = $e->validator->errors()->first();

            return response()->json([
                'error' => $message,
                'code' => 'bad_request',
            ], 400);
        });
        $exceptions->render(function (PostTooLargeException $e) {
            return response()->json(WgwOversizedPost::payload(), 413);
        });
        $exceptions->render(function (AuthenticationException $e, Request $request) {
            if (! $request->is('mcp') && ! $request->is('mcp/*')) {
                return null;
            }

            return McpPublicOrigin::unauthorized($request);
        });
        $exceptions->render(function (MethodNotAllowedHttpException $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            return response()->json([
                'error' => 'Method not allowed.',
                'code' => 'method_not_allowed',
            ], 405);
        });
        $exceptions->render(function (Throwable $e, Request $request) {
            if (! $request->is('api/*')) {
                return null;
            }

            $status = $e instanceof HttpExceptionInterface ? $e->getStatusCode() : 500;
            if ($status < 400 || $status >= 600) {
                $status = 500;
            }

            $code = match ($status) {
                400 => 'bad_request',
                401 => 'unauthorized',
                403 => 'forbidden',
                404 => 'not_found',
                405 => 'method_not_allowed',
                413 => 'post_too_large',
                429 => 'rate_limited',
                default => 'server_error',
            };

            $message = config('app.debug')
                ? ($e->getMessage() ?: 'Internal server error.')
                : match ($code) {
                    'bad_request' => 'Bad request.',
                    'unauthorized' => 'Unauthorized.',
                    'forbidden' => 'Forbidden.',
                    'not_found' => 'Not found.',
                    'method_not_allowed' => 'Method not allowed.',
                    'post_too_large' => 'Upload too large.',
                    'rate_limited' => 'Too many requests.',
                    default => 'Internal server error.',
                };

            return response()->json([
                'error' => $message,
                'code' => $code,
            ], $status, $e instanceof HttpExceptionInterface ? $e->getHeaders() : []);
        });
    })
    ->booted(function (): void {
        WgwApiRateLimiters::register();
        JmapPushRateLimiters::register();
        GuestUploadRateLimiters::register();
    })
    ->create();

// A fresh install whose data directory is outside the published tree keeps
// its .env there too (#1484). Web, artisan, the queue and the scheduler all
// boot through this file, so they all read the same one.
$relocatedEnv = WgwEnvLocation::relocatedForBoot($app->basePath());
if ($relocatedEnv !== null) {
    $app->useEnvironmentPath(dirname($relocatedEnv));
    $app->loadEnvironmentFrom(basename($relocatedEnv));
}

$storagePath = getenv('WGW_STORAGE_PATH');
if (! is_string($storagePath) || $storagePath === '') {
    $fromEnv = $_ENV['WGW_STORAGE_PATH'] ?? null;
    $storagePath = is_string($fromEnv) ? $fromEnv : '';
}
$storagePath = trim($storagePath);
if ($storagePath !== '') {
    $app->useStoragePath($storagePath);
}

return $app;

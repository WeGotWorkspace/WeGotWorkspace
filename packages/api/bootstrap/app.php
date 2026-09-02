<?php

declare(strict_types=1);

use App\Exceptions\ApiHttpException;
use App\Http\Middleware\AuthenticateWgwApi;
use App\Http\Middleware\EnsureCalendarsEnabled;
use App\Http\Middleware\EnsureContactsEnabled;
use App\Http\Middleware\EnsureTasksEnabled;
use App\Http\Middleware\RequireWgwRole;
use App\Http\Middleware\WgwSecurityHeaders;
use App\Services\Collab\CollabResponseException;
use App\Services\Mail\MailResponseException;
use App\Services\Meet\MeetResponseException;
use App\Services\Principal\PrincipalResponseException;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;
use Symfony\Component\HttpKernel\Exception\MethodNotAllowedHttpException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        apiPrefix: 'api/v1',
        then: function (): void {
            require __DIR__.'/../routes/docs.php';
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->encryptCookies(except: [
            'sabre_ui_auth',
        ]);
        $middleware->alias([
            'wgw.auth' => AuthenticateWgwApi::class,
            'wgw.role' => RequireWgwRole::class,
            'wgw.contacts' => EnsureContactsEnabled::class,
            'wgw.calendars' => EnsureCalendarsEnabled::class,
            'wgw.tasks' => EnsureTasksEnabled::class,
        ]);
        $middleware->appendToGroup('web', [
            WgwSecurityHeaders::class,
        ]);
        $middleware->validateCsrfTokens(except: [
            '*',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->render(function (MailResponseException $e) {
            return response()->json($e->payload, $e->status);
        });
        $exceptions->render(function (MeetResponseException $e) {
            return response()->json($e->payload, $e->status);
        });
        $exceptions->render(function (CollabResponseException $e) {
            return response()->json($e->payload, $e->status);
        });
        $exceptions->render(function (PrincipalResponseException $e) {
            return response()->json($e->payload, $e->status);
        });
        $exceptions->render(function (ApiHttpException $e) {
            $payload = ['error' => $e->getMessage()];
            if ($e->errorCode() !== null) {
                $payload['code'] = $e->errorCode();
            }

            return response()->json($payload, $e->getStatusCode());
        });
        $exceptions->render(function (ValidationException $e) {
            $message = $e->validator->errors()->first() ?? 'Invalid request.';

            return response()->json([
                'error' => $message,
                'code' => 'bad_request',
            ], 400);
        });
        $exceptions->render(function (PostTooLargeException $e) {
            $max = trim((string) ini_get('post_max_size'));
            $hint = $max !== '' ? "Current server post_max_size is {$max}." : 'Current server post_max_size is too low.';

            return response()->json([
                'error' => "Upload too large. {$hint}",
                'code' => 'post_too_large',
            ], 413);
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
                401 => 'unauthorized',
                403 => 'forbidden',
                404 => 'not_found',
                405 => 'method_not_allowed',
                413 => 'post_too_large',
                default => 'server_error',
            };

            $message = config('app.debug')
                ? ($e->getMessage() ?: 'Internal server error.')
                : match ($code) {
                    'unauthorized' => 'Unauthorized.',
                    'forbidden' => 'Forbidden.',
                    'not_found' => 'Not found.',
                    'method_not_allowed' => 'Method not allowed.',
                    'post_too_large' => 'Upload too large.',
                    default => 'Internal server error.',
                };

            return response()->json([
                'error' => $message,
                'code' => $code,
            ], $status);
        });
    })
    ->create();

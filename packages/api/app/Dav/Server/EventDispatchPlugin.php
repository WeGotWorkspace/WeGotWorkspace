<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Events\EventDispatch;
use Illuminate\Support\Facades\Log;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * DAV HTTP entry for suite events. Isolates exceptions (never fail the write).
 * Protocol-split: this plugin is for native DAV clients only — REST/JMAP fire
 * from repositories, not by proxying through Sabre.
 */
class EventDispatchPlugin extends ServerPlugin
{
    private ?Server $server = null;

    public function __construct(private readonly EventDispatch $events) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        foreach (['PUT', 'PATCH', 'MKCOL', 'DELETE', 'MOVE', 'COPY'] as $method) {
            $server->on('afterMethod:'.$method, [$this, 'afterWriteMethod']);
        }
    }

    public function afterWriteMethod(RequestInterface $request, ResponseInterface $response): void
    {
        $status = $response->getStatus();
        if ($status < 200 || $status >= 400) {
            return;
        }

        $path = trim((string) $request->getPath(), '/');
        if ($path === '') {
            return;
        }

        $actor = $this->currentActorUsername();
        if ($actor === '') {
            return;
        }

        $method = strtoupper($request->getMethod());
        $action = match ($method) {
            'DELETE' => 'deleted',
            'MOVE' => 'moved',
            'COPY' => 'copied',
            default => 'written',
        };

        $target = $path;
        if ($method === 'MOVE' || $method === 'COPY') {
            $destination = $this->destinationPath($request);
            if ($destination !== '') {
                $target = $destination;
            }
        }

        try {
            $this->events->fireMutation(
                $actor,
                $this->domainFromPath($path),
                $action,
                $target,
                [
                    'method' => $method,
                    'path' => $path,
                ],
            );
        } catch (\Throwable $e) {
            try {
                Log::warning('event_dispatch_failed', [
                    'entry' => 'dav_plugin',
                    'method' => $method,
                    'path' => $path,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }
    }

    protected function currentActorUsername(): string
    {
        if ($this->server === null) {
            return '';
        }
        $auth = $this->server->getPlugin('auth');
        $principal = $auth instanceof AuthPlugin ? (string) $auth->getCurrentPrincipal() : '';
        if ($principal === '') {
            return '';
        }
        if (str_starts_with($principal, 'principals/groups/')) {
            return '';
        }
        if (str_starts_with($principal, 'principals/')) {
            return substr($principal, strlen('principals/'));
        }

        return $principal;
    }

    private function destinationPath(RequestInterface $request): string
    {
        if ($this->server === null) {
            return '';
        }
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '') {
            return '';
        }
        try {
            return trim((string) $this->server->calculateUri($destination), '/');
        } catch (\Throwable) {
            return '';
        }
    }

    private function domainFromPath(string $path): string
    {
        $first = explode('/', $path, 2)[0] ?? '';

        return match ($first) {
            'files' => 'drive',
            'addressbooks' => 'contacts',
            'calendars' => 'calendar',
            default => $first !== '' ? $first : 'unknown',
        };
    }
}

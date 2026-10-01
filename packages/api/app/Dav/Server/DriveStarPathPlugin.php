<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DriveStarService;
use App\Storage\StoragePaths;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Keeps path-keyed drive stars on the WebDAV MOVE and DELETE paths.
 * COPY leaves the original star where it is. Non-file trees are ignored.
 */
final class DriveStarPathPlugin extends ServerPlugin
{
    private ?Server $server = null;

    public function __construct(
        private readonly DriveStarService $stars,
        private readonly StoragePaths $paths,
    ) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('afterMethod:MOVE', [$this, 'afterMove']);
        $server->on('afterMethod:DELETE', [$this, 'afterDelete']);
    }

    public function getPluginName(): string
    {
        return 'drive-star-path';
    }

    public function afterMove(RequestInterface $request, ResponseInterface $response): void
    {
        if (! $this->succeeded($response)) {
            return;
        }

        $from = $this->virtualFilesPath((string) $request->getPath());
        $to = $this->virtualFilesPath($this->destinationPath($request));
        if ($from === null || $to === null) {
            return;
        }

        $this->stars->rewritePathPrefix($from, $to);
    }

    public function afterDelete(RequestInterface $request, ResponseInterface $response): void
    {
        if (! $this->succeeded($response)) {
            return;
        }

        $path = $this->virtualFilesPath((string) $request->getPath());
        if ($path === null) {
            return;
        }

        $this->stars->deletePathPrefix($path);
    }

    private function succeeded(ResponseInterface $response): bool
    {
        $status = $response->getStatus();

        return $status >= 200 && $status < 400;
    }

    private function destinationPath(RequestInterface $request): string
    {
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '') {
            return '';
        }
        if ($this->server !== null) {
            try {
                return trim((string) $this->server->calculateUri($destination), '/');
            } catch (\Throwable) {
                return '';
            }
        }

        $parsed = parse_url($destination, PHP_URL_PATH);
        $path = is_string($parsed) && $parsed !== '' ? $parsed : $destination;

        return trim($path, '/');
    }

    /**
     * DAV paths under the files tree are `files/{storage key}`.
     */
    private function virtualFilesPath(string $davPath): ?string
    {
        $davPath = trim($davPath, '/');
        if (! str_starts_with($davPath, 'files/')) {
            return null;
        }
        $key = substr($davPath, strlen('files/'));
        if ($key === '') {
            return null;
        }

        return $this->paths->normalizeVirtualPath('/'.$key);
    }
}

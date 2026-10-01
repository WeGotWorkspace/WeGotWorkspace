<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DriveShareService;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Rewrites drive_shares.path after a successful WebDAV MOVE so member and
 * public grants follow the file, matching DriveService::renameItem.
 */
final class DriveShareMovePlugin extends ServerPlugin
{
    private ?Server $server = null;

    public function __construct(private readonly DriveShareService $shares) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('afterMethod:MOVE', [$this, 'afterMove']);
    }

    public function afterMove(RequestInterface $request, ResponseInterface $response): void
    {
        $status = $response->getStatus();
        if ($status < 200 || $status >= 400) {
            return;
        }

        $from = $this->shareVirtualPath((string) $request->getPath());
        $to = $this->shareVirtualPath($this->destinationDavPath($request));
        if ($from === null || $to === null) {
            return;
        }

        $this->shares->rewritePathPrefix($from, $to);
    }

    private function destinationDavPath(RequestInterface $request): string
    {
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '' || $this->server === null) {
            return '';
        }
        try {
            return trim((string) $this->server->calculateUri($destination), '/');
        } catch (\Throwable) {
            return '';
        }
    }

    /**
     * DAV file paths are `files/{storage key}`; share rows use `/{storage key}`.
     */
    private function shareVirtualPath(string $davPath): ?string
    {
        $davPath = trim($davPath, '/');
        if (! str_starts_with($davPath, 'files/')) {
            return null;
        }
        $key = substr($davPath, strlen('files/'));
        if ($key === '') {
            return null;
        }

        return '/'.$key;
    }
}

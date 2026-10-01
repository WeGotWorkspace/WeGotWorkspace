<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DriveShareService;
use Illuminate\Support\Facades\Log;
use Sabre\DAV\ICollection;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Rewrites drive_shares.path after a successful WebDAV MOVE so member and
 * public grants follow the file, like DriveService::renameItem does.
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

        $server = $this->server;
        $destDavPath = $this->destinationDavPath($request);
        $from = $this->shareVirtualPath((string) $request->getPath());
        $to = $this->shareVirtualPath($destDavPath);
        if ($from === null || $to === null || $server === null) {
            return;
        }
        if (! $server->tree->getNodeForPath($destDavPath) instanceof ICollection && $this->isSwapTempName($to)) {
            return;
        }

        try {
            $this->shares->rewritePathPrefix($from, $to);
        } catch (\Throwable $e) {
            Log::error('drive_share_move_rewrite_failed', [
                'from' => $from,
                'to' => $to,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Office and editor save swaps rename the real file onto a temp name.
     * Rewriting the grant onto that name drops it when the temp file is deleted.
     */
    private function isSwapTempName(string $virtualPath): bool
    {
        $name = basename($virtualPath);
        if ($name === '' || $name === '.' || $name === '..') {
            return false;
        }

        return str_starts_with($name, '~')
            || str_ends_with($name, '.tmp')
            || str_starts_with($name, '.~lock.')
            || str_ends_with($name, '~')
            || str_starts_with($name, '.#');
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

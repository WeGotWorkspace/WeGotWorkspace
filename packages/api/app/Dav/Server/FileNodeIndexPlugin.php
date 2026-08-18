<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Illuminate\Support\Facades\Log;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Keeps the FileNode node-identity index (#450) in sync with WebDAV writes —
 * the SearchIndexPlugin pattern. MOVE re-keys the index subtree while
 * keeping every node id: this is where rename-stability comes from on the
 * DAV path. Best-effort: index failures log and never fail the DAV request.
 */
final class FileNodeIndexPlugin extends ServerPlugin
{
    private Server $server;

    public function __construct(private readonly FileNodeIndexService $index) {}

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

        $key = $this->storageKey((string) $request->getPath());
        if ($key === null) {
            return;
        }

        try {
            $method = strtoupper($request->getMethod());
            switch ($method) {
                case 'DELETE':
                    $this->index->recordDelete($key);
                    break;
                case 'MOVE':
                case 'COPY':
                    $destKey = $this->destinationKey($request);
                    if ($destKey === null) {
                        break;
                    }
                    if ($method === 'MOVE') {
                        $this->index->recordMove($key, $destKey);
                    } else {
                        $this->index->recordCreate($destKey);
                    }
                    break;
                case 'MKCOL':
                    $this->index->recordCreate($key);
                    break;
                default: // PUT, PATCH
                    $this->index->recordContentWrite($key);
                    break;
            }
        } catch (\Throwable $e) {
            Log::warning('file_node_index_sync_failed', [
                'method' => $request->getMethod(),
                'path' => $request->getPath(),
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function destinationKey(RequestInterface $request): ?string
    {
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '') {
            return null;
        }
        try {
            $destPath = trim((string) $this->server->calculateUri($destination), '/');
        } catch (\Throwable) {
            return null;
        }

        return $this->storageKey($destPath);
    }

    /**
     * DAV paths under the files tree are `files/{storage key}`.
     */
    private function storageKey(string $davPath): ?string
    {
        $davPath = trim($davPath, '/');
        if (! str_starts_with($davPath, 'files/')) {
            return null;
        }
        $key = substr($davPath, strlen('files/'));

        return $key !== '' ? $key : null;
    }
}

<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DocAttachmentsService;
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
    private ?Server $server = null;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly DocAttachmentsService $attachments,
    ) {}

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

        $method = strtoupper($request->getMethod());
        $docIds = [];
        $destKey = $method === 'MOVE' || $method === 'COPY' ? $this->destinationKey($request) : null;
        if ($method === 'DELETE') {
            try {
                $docIds = $this->attachments->docNodeIdsForDestroyKey($key);
            } catch (\Throwable $e) {
                Log::warning('doc_attachments_sidecar_failed', [
                    'op' => 'enumerate',
                    'method' => $method,
                    'path' => $request->getPath(),
                    'error' => $e->getMessage(),
                ]);
            }
        }

        try {
            switch ($method) {
                case 'DELETE':
                    $this->index->recordDelete($key);
                    break;
                case 'MOVE':
                case 'COPY':
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

        if ($method === 'DELETE') {
            $this->attachments->destroyDocsBestEffort($docIds);

            return;
        }
        if ($method === 'MOVE' && $destKey !== null) {
            $this->attachments->relocateAfterMoveBestEffort($key, $destKey);
        }
    }

    private function destinationKey(RequestInterface $request): ?string
    {
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '') {
            return null;
        }
        $destPath = $destination;
        if ($this->server !== null) {
            try {
                $destPath = trim((string) $this->server->calculateUri($destination), '/');
            } catch (\Throwable) {
                return null;
            }
        } else {
            $parsed = parse_url($destination, PHP_URL_PATH);
            $destPath = is_string($parsed) && $parsed !== '' ? $parsed : $destination;
            $destPath = trim($destPath, '/');
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

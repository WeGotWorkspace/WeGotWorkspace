<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DocAttachmentsService;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\Streams\HashingStreamFilter;
use App\Storage\Streams\StreamDigest;
use Illuminate\Support\Facades\Log;
use Sabre\DAV\ICollection;
use Sabre\DAV\IFile;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * Keeps the FileNode node-identity index (#450) in sync with WebDAV writes —
 * the SearchIndexPlugin pattern. MOVE re-keys the index subtree while
 * keeping every node id: this is where rename-stability comes from on the
 * DAV path. MOVE also takes the Yjs sidecar with the document; COPY does
 * not. Best-effort: index failures log and never fail the DAV request.
 *
 * content_sha256 is the true sha256 (#1500): a PUT body is hashed by a read
 * filter while Sabre streams it to storage (attached on beforeWriteContent
 * / beforeCreateFile, which run after ACL and preconditions, at a late
 * priority so no other plugin reads the stream after it). COPY carries the
 * source hashes across without reading the files.
 *
 * DAV PATCH is not served: Sabre\DAV\PartialUpdate\Plugin is not
 * registered, although FlysystemFile implements IPatchSupport. If it ever
 * is, a partial write needs a full streamed re-hash — the hash cannot be
 * derived from the patch bytes — which recordContentWrite() without a hash
 * already does (small files now, larger ones as hash-pending).
 */
final class FileNodeIndexPlugin extends ServerPlugin
{
    private ?Server $server = null;

    /** @var array<string, StreamDigest> storage key → digest of the body being written */
    private array $digests = [];

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
        $server->on('beforeWriteContent', [$this, 'beforeWriteContent'], 900);
        $server->on('beforeCreateFile', [$this, 'beforeCreateFile'], 900);
    }

    /**
     * @param  resource|string|null  $data
     */
    public function beforeWriteContent(string $path, IFile $node, &$data, bool &$modified): bool
    {
        $this->hashBody($path, $data);

        return true;
    }

    /**
     * @param  resource|string|null  $data
     */
    public function beforeCreateFile(string $path, &$data, ICollection $parent, bool &$modified): bool
    {
        $this->hashBody($path, $data);

        return true;
    }

    /**
     * @param  resource|string|null  $data
     */
    private function hashBody(string $path, mixed &$data): void
    {
        $key = $this->storageKey($path);
        if ($key === null) {
            return;
        }
        try {
            $digest = new StreamDigest;
            if (is_resource($data)) {
                HashingStreamFilter::attach($data, $digest);
            } elseif (is_string($data)) {
                $digest->accept($data);
            } elseif ($data === null) {
                $digest->accept('');
            } else {
                return;
            }
            $this->digests[$key] = $digest;
        } catch (\Throwable $e) {
            // Best effort: without a digest the write is hashed like a
            // discovered file.
            Log::warning('file_node_put_hash_failed', ['path' => $path, 'error' => $e->getMessage()]);
        }
    }

    private function writtenSha(string $key): ?string
    {
        $digest = $this->digests[$key] ?? null;
        unset($this->digests[$key]);

        return $digest?->hex();
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
                    $this->index->recordDeleteWithSidecar($key);
                    break;
                case 'MOVE':
                case 'COPY':
                    if ($destKey === null) {
                        break;
                    }
                    if ($method === 'MOVE') {
                        $this->index->recordMoveWithSidecar($key, $destKey);
                    } else {
                        $this->index->recordCopy($key, $destKey);
                    }
                    break;
                case 'MKCOL':
                    $this->index->recordCreate($key);
                    break;
                default: // PUT (PATCH is not served; see the class doc)
                    $this->index->recordContentWrite($key, $method === 'PUT' ? $this->writtenSha($key) : null);
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

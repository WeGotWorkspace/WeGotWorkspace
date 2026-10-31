<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Drive\DrivePathBookkeeping;
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
 * The one WebDAV hook for Drive writes — the SearchIndexPlugin pattern.
 * PUT, MKCOL and COPY (and PATCH, once served) update the FileNode index (#450).
 * MOVE and DELETE hand off to DrivePathBookkeeping, the same service REST and
 * JMAP use, so index and Yjs sidecars, attachments, stars, share paths and
 * docs threads follow the file. COPY copies none of that. Best-effort:
 * failures log and never fail the DAV request.
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
        private readonly DrivePathBookkeeping $pathBookkeeping,
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
        $destDavPath = $method === 'MOVE' || $method === 'COPY' ? $this->destinationDavPath($request) : null;
        $destKey = $destDavPath !== null ? $this->storageKey($destDavPath) : null;
        if ($method === 'DELETE') {
            $this->pathBookkeeping->afterDelete($key);

            return;
        }
        if ($method === 'MOVE') {
            if ($destKey !== null) {
                $this->pathBookkeeping->afterMove($key, $destKey, $this->isSaveSwap($key, $destKey, $destDavPath));
            }

            return;
        }

        try {
            match ($method) {
                'COPY' => $destKey !== null ? $this->index->recordCopy($key, $destKey) : null,
                'MKCOL' => $this->index->recordCreate($key),
                // PUT (PATCH is not served; see the class doc)
                default => $this->index->recordContentWrite($key, $method === 'PUT' ? $this->writtenSha($key) : null),
            };
        } catch (\Throwable $e) {
            Log::warning('file_node_index_sync_failed', [
                'method' => $request->getMethod(),
                'path' => $request->getPath(),
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Office and editor saves rename the document to or from a temporary
     * name. A folder with such a name is a real move.
     */
    private function isSaveSwap(string $fromKey, string $toKey, string $destDavPath): bool
    {
        if (! $this->isSwapTempName($fromKey) && ! $this->isSwapTempName($toKey)) {
            return false;
        }

        return ! $this->isCollection($destDavPath);
    }

    private function isSwapTempName(string $key): bool
    {
        $name = basename($key);
        if ($name === '' || $name === '.' || $name === '..') {
            return false;
        }

        return str_starts_with($name, '~')
            || str_ends_with($name, '.tmp')
            || str_starts_with($name, '.~lock.')
            || str_ends_with($name, '~')
            || str_starts_with($name, '.#');
    }

    /**
     * A failed lookup counts as a file, so a missing destination cannot fail
     * a MOVE that already finished.
     */
    private function isCollection(string $davPath): bool
    {
        try {
            return $this->server?->tree->getNodeForPath($davPath) instanceof ICollection;
        } catch (\Throwable) {
            return false;
        }
    }

    private function destinationDavPath(RequestInterface $request): ?string
    {
        $destination = $request->getHeader('Destination');
        if (! is_string($destination) || $destination === '') {
            return null;
        }
        if ($this->server !== null) {
            try {
                return trim((string) $this->server->calculateUri($destination), '/');
            } catch (\Throwable) {
                return null;
            }
        }
        $parsed = parse_url($destination, PHP_URL_PATH);
        $destPath = is_string($parsed) && $parsed !== '' ? $parsed : $destination;

        return trim($destPath, '/');
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

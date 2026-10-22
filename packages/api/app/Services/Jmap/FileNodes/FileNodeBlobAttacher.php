<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Models\JmapAttachStaging;
use App\Models\JmapBlob;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\Blobs\JmapBlobLimits;
use App\Services\Jmap\Blobs\JmapBlobReferenceGuard;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\Blobs\StorageFullException;
use App\Storage\Local\LocalDiskFiles;
use App\Storage\Streams\HashingStreamFilter;
use App\Storage\Streams\StreamDigest;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Attaches an uploaded `jb-` blob to a FileNode by streaming, never through
 * a PHP string (#1500).
 *
 * Attaching is a move (rename across the wgw_data and wgw_files disks) only
 * when this is the last reference to the blob — no later create or update
 * in the same FileNode/set uses it, no reference checker vetoes it, both
 * disks are local on one device — and the blob row was deleted inside a
 * lockForUpdate transaction, so a concurrent request cannot validate the
 * blob and then find its file gone. Everything else is a streamed copy
 * through a staging file on wgw_files (a failed copy never truncates the
 * target): within one step budget in this call, or split across calls
 * (SetError `attachInProgress`; the client repeats the same FileNode/set).
 *
 * Accepted peak disk use: about 1× the file with a move (parts are deleted
 * as they are appended), about 2× with a copy.
 */
final class FileNodeBlobAttacher
{
    private const STAGING_ROOT = '.wgw-staging';

    public function __construct(
        private readonly WgwStorage $storage,
        private readonly JmapBlobService $blobs,
        private readonly LocalDiskFiles $local,
        private readonly JmapBlobReferenceGuard $references,
        private readonly FreeSpaceSource $freeSpace,
    ) {}

    /**
     * @return array{sha256: string, size: int}
     *
     * @throws FileNodeSetError
     */
    public function attach(string $username, string $blobId, string $targetKey, bool $lastReference, ?int $expectedSize): array
    {
        $row = $this->blobs->find($username, $blobId);
        if ($row === null) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Unknown blobId.', 'properties' => ['blobId']]);
        }
        if ($expectedSize !== null && $expectedSize !== $row->size_bytes) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'size does not match the blob.', 'properties' => ['size']]);
        }

        try {
            $staging = $this->stagingFor($username, $blobId, $targetKey);
            if ($staging === null && $lastReference && $this->tryMove($username, $row, $targetKey)) {
                return ['sha256' => $row->sha256, 'size' => $row->size_bytes];
            }

            return $this->copy($username, $row, $targetKey, $staging);
        } catch (StorageFullException) {
            throw new FileNodeSetError(['type' => 'overQuota', 'description' => 'The server has no space left for this file.']);
        }
    }

    /**
     * Removes staged copies nobody resumed within the assembly TTL.
     */
    public function expireStaging(int $limit = 25): int
    {
        $rows = JmapAttachStaging::query()
            ->where('updated_at', '<', Carbon::now()->subSeconds(JmapBlobLimits::assemblyTtlSeconds()))
            ->orderBy('id')
            ->limit($limit)
            ->get();
        foreach ($rows as $staging) {
            $this->blobs->deleteQuietly($this->storage->files(), $staging->staging_key);
            $staging->delete();
        }

        return $rows->count();
    }

    private function tryMove(string $username, JmapBlob $row, string $targetKey): bool
    {
        $data = $this->storage->data();
        $files = $this->storage->files();
        if (! $this->local->isLocal($data) || ! $this->local->isLocal($files)
            || $this->references->isReferenced($username, $row->blob_id)) {
            return false;
        }
        $source = $this->local->absolutePath($data, $this->blobs->blobKey($username, $row->blob_id));
        $targetDir = dirname($this->local->absolutePath($files, $targetKey));
        $probe = is_dir($targetDir) ? $targetDir : $this->local->absolutePath($files, '');
        if (! $this->local->sameDevice($source, $probe)) {
            return false;
        }

        // Claim the blob exclusively: delete its row under a lock, so no
        // other request validates it after this point.
        $claimed = DB::connection('wgw')->transaction(function () use ($username, $row): ?array {
            $locked = JmapBlob::query()
                ->where('username', $username)
                ->where('blob_id', $row->blob_id)
                ->lockForUpdate()
                ->first();
            if ($locked === null || ($locked->in_use_until !== null && $locked->in_use_until->isFuture())) {
                return null;
            }
            $attributes = $locked->getAttributes();
            $locked->delete();

            return $attributes;
        });
        if ($claimed === null) {
            return false;
        }

        if ($this->local->moveAcross($data, $this->blobs->blobKey($username, $row->blob_id), $files, $targetKey)) {
            return true;
        }
        // The rename failed after all: hand the blob back and copy instead.
        unset($claimed['id']);
        JmapBlob::query()->insert($claimed);

        return false;
    }

    /**
     * @return array{sha256: string, size: int}
     */
    private function copy(string $username, JmapBlob $row, string $targetKey, ?JmapAttachStaging $staging): array
    {
        $files = $this->storage->files();
        $copied = $staging !== null ? $staging->copied_bytes : 0;
        $free = $this->freeSpace->freeBytes($files);
        if ($free !== null && $row->size_bytes - $copied > $free) {
            throw new FileNodeSetError(['type' => 'overQuota', 'description' => 'Not enough free space for this file.']);
        }
        $budget = JmapBlobLimits::stepBudgetBytes();
        if ($staging === null && $row->size_bytes <= $budget) {
            return $this->copyInOneStep($username, $row, $targetKey);
        }

        $staging ??= JmapAttachStaging::query()->create([
            'username' => $username,
            'blob_id' => $row->blob_id,
            'target_hash' => hash('sha256', $targetKey),
            'target_key' => $targetKey,
            'staging_key' => $this->stagingKey($username),
            'size_bytes' => $row->size_bytes,
            'copied_bytes' => 0,
        ]);
        $this->local->truncate($files, $staging->staging_key, $staging->copied_bytes);
        $source = $this->blobs->openStream($username, $row->blob_id);
        if ($source === null) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Unknown blobId.', 'properties' => ['blobId']]);
        }
        try {
            if ($staging->copied_bytes > 0 && fseek($source, $staging->copied_bytes) !== 0) {
                throw new \RuntimeException('Could not seek in the blob.');
            }
            $written = $this->local->append($files, $staging->staging_key, $source, min($budget, $row->size_bytes - $staging->copied_bytes));
        } finally {
            fclose($source);
        }
        $staging->copied_bytes += $written;
        $staging->save();

        if ($staging->copied_bytes < $row->size_bytes) {
            throw new FileNodeSetError([
                'type' => 'attachInProgress',
                'description' => 'The file is still being copied; repeat this FileNode/set.',
                'copied' => $staging->copied_bytes,
                'size' => $row->size_bytes,
            ]);
        }
        if (! $files->move($staging->staging_key, $targetKey)) {
            throw new \RuntimeException('Could not place the copied file.');
        }
        $staging->delete();

        // Staged across calls: the bytes are the stored blob's, whose sha256
        // was computed when it was written.
        return ['sha256' => $row->sha256, 'size' => $row->size_bytes];
    }

    /**
     * @return array{sha256: string, size: int}
     */
    private function copyInOneStep(string $username, JmapBlob $row, string $targetKey): array
    {
        $files = $this->storage->files();
        // Keeps a concurrent attach from moving the file away mid-copy.
        JmapBlob::query()->where('id', $row->id)->update([
            'in_use_until' => Carbon::now()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5),
        ]);
        $stagingKey = $this->stagingKey($username);
        $digest = new StreamDigest;
        try {
            $source = $this->blobs->openStream($username, $row->blob_id);
            if ($source === null) {
                throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Unknown blobId.', 'properties' => ['blobId']]);
            }
            try {
                HashingStreamFilter::attach($source, $digest);
                $files->writeStream($stagingKey, $source);
            } catch (FileNodeSetError $e) {
                throw $e;
            } catch (\Throwable $e) {
                throw StorageFullException::fromThrowable($e) ?? $e;
            } finally {
                fclose($source);
            }
            if (! $files->move($stagingKey, $targetKey)) {
                throw new \RuntimeException('Could not place the copied file.');
            }
        } catch (\Throwable $e) {
            $this->blobs->deleteQuietly($files, $stagingKey);
            throw $e;
        } finally {
            JmapBlob::query()->where('id', $row->id)->update(['in_use_until' => null]);
        }

        return ['sha256' => $digest->hex(), 'size' => $digest->bytes];
    }

    private function stagingFor(string $username, string $blobId, string $targetKey): ?JmapAttachStaging
    {
        return JmapAttachStaging::query()
            ->where('username', $username)
            ->where('blob_id', $blobId)
            ->where('target_hash', hash('sha256', $targetKey))
            ->first();
    }

    private function stagingKey(string $username): string
    {
        // Outside users/ and groups/: never indexed, never listed over DAV,
        // and on the same disk as the target so placing it is a rename.
        return self::STAGING_ROOT.'/'.$username.'/'.Str::lower(Str::random(32));
    }
}

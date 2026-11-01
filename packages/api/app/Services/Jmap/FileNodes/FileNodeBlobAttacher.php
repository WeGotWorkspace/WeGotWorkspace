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
use Illuminate\Database\QueryException;
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
     * `$beforePlace` runs once, after the blob is known, its size matches and
     * its bytes are fully available, right before the target changes. Every
     * outcome that can still refuse the attach (attachInProgress, overQuota)
     * comes first, so a caller can destroy or rename there without losing
     * anything when the attach is refused.
     *
     * @param  (callable(): mixed)|null  $beforePlace
     * @return array{sha256: string, size: int}
     *
     * @throws FileNodeSetError
     */
    public function attach(string $username, string $blobId, string $targetKey, bool $lastReference, ?int $expectedSize, ?callable $beforePlace = null): array
    {
        $row = $this->blobs->find($username, $blobId);
        if ($row === null) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Unknown blobId.', 'properties' => ['blobId']]);
        }
        if ($expectedSize !== null && $expectedSize !== $row->size_bytes) {
            throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'size does not match the blob.', 'properties' => ['size']]);
        }
        $placing = null;
        if ($beforePlace !== null) {
            $done = false;
            $placing = static function () use (&$done, $beforePlace): void {
                if (! $done) {
                    $done = true;
                    $beforePlace();
                }
            };
        }

        try {
            $staging = $this->stagingFor($username, $blobId, $targetKey);
            if ($staging === null && $lastReference && $this->tryMove($username, $row, $targetKey, $placing)) {
                return ['sha256' => $row->sha256, 'size' => $row->size_bytes];
            }

            return $this->copy($username, $row, $targetKey, $staging, $placing);
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

    private function tryMove(string $username, JmapBlob $row, string $targetKey, ?\Closure $placing): bool
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

        // Get the bytes onto wgw_files first: the rename can still fail
        // (EXDEV between bind mounts, permissions) and nothing may have been
        // destroyed by then, so the copy fallback can still refuse safely.
        $blobKey = $this->blobs->blobKey($username, $row->blob_id);
        $stagingKey = $this->stagingKey($username);
        if (! $this->local->moveAcross($data, $blobKey, $files, $stagingKey)) {
            $this->restoreClaimed($claimed);

            return false;
        }
        try {
            if ($placing !== null) {
                $placing();
            }
            if (! $files->move($stagingKey, $targetKey)) {
                throw new \RuntimeException('Could not place the moved file.');
            }
        } catch (\Throwable $e) {
            // Refused after all: hand the blob back untouched.
            if (! $this->local->moveAcross($files, $stagingKey, $data, $blobKey)) {
                $this->blobs->deleteQuietly($files, $stagingKey);
            } else {
                $this->restoreClaimed($claimed);
            }
            throw $e;
        }

        return true;
    }

    /**
     * @param  array<string, mixed>  $claimed
     */
    private function restoreClaimed(array $claimed): void
    {
        unset($claimed['id']);
        JmapBlob::query()->insert($claimed);
    }

    /**
     * @return array{sha256: string, size: int}
     */
    private function copy(string $username, JmapBlob $row, string $targetKey, ?JmapAttachStaging $staging, ?\Closure $placing): array
    {
        $files = $this->storage->files();
        $copied = $staging !== null ? $staging->copied_bytes : 0;
        $free = $this->freeSpace->freeBytes($files);
        if ($free !== null && $row->size_bytes - $copied > $free) {
            throw new FileNodeSetError(['type' => 'overQuota', 'description' => 'Not enough free space for this file.']);
        }
        $budget = JmapBlobLimits::stepBudgetBytes();
        if ($staging === null && $row->size_bytes <= $budget) {
            return $this->copyInOneStep($username, $row, $targetKey, $placing);
        }

        $staging = $this->leaseStaging($username, $row, $targetKey, $staging);
        if ($staging->copied_bytes > 0) {
            $onDisk = $this->local->size($files, $staging->staging_key);
            if ($onDisk === null || $onDisk < $staging->copied_bytes) {
                // The staged bytes are gone: never extend the file with
                // zeros, start over.
                $this->dropStaging($staging);
                $staging = $this->leaseStaging($username, $row, $targetKey, null);
            }
        }
        $token = (string) $staging->lease_token;
        $copied = $staging->copied_bytes;
        try {
            $this->local->truncate($files, $staging->staging_key, $copied);
            $source = $this->blobs->openStream($username, $row->blob_id);
            if ($source === null) {
                throw new FileNodeSetError(['type' => 'invalidProperties', 'description' => 'Unknown blobId.', 'properties' => ['blobId']]);
            }
            try {
                if ($copied > 0 && fseek($source, $copied) !== 0) {
                    throw new \RuntimeException('Could not seek in the blob.');
                }
                $renewedAt = time();
                $written = $this->local->append($files, $staging->staging_key, $source, min($budget, $row->size_bytes - $copied), function () use ($staging, $token, &$renewedAt, $row): void {
                    // Disk time is not counted by max_execution_time: keep
                    // the lease alive while bytes flow, and stop if it was lost.
                    if (time() - $renewedAt >= 5) {
                        $renewedAt = time();
                        $renewed = JmapAttachStaging::query()->where('id', $staging->id)->where('lease_token', $token)
                            ->update(['locked_until' => Carbon::now()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5)]);
                        if ($renewed !== 1) {
                            throw $this->stagingBusy($staging->copied_bytes, $row->size_bytes);
                        }
                    }
                });
            } finally {
                fclose($source);
            }
            if ($written === 0 && $copied < $row->size_bytes) {
                // The stored blob ended early: retrying can never finish it.
                $this->dropStaging($staging);
                throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'The uploaded blob is shorter than its recorded size.']);
            }
            $copied += $written;
            // Commit only while this call still owns the lease; keep it on
            // the final step until the file is placed.
            $final = $copied >= $row->size_bytes;
            $update = ['copied_bytes' => $copied, 'updated_at' => Carbon::now()];
            if (! $final) {
                $update += ['locked_until' => null, 'lease_token' => null];
            }
            $kept = JmapAttachStaging::query()->where('id', $staging->id)->where('lease_token', $token)->update($update);
            if ($kept !== 1) {
                throw $this->stagingBusy($copied, $row->size_bytes);
            }
            if (! $final) {
                throw new FileNodeSetError([
                    'type' => 'attachInProgress',
                    'description' => 'The file is still being copied; repeat this FileNode/set.',
                    'copied' => $copied,
                    'size' => $row->size_bytes,
                ]);
            }
            // The staged file must be exactly the blob before it replaces anything.
            if ($this->local->size($files, $staging->staging_key) !== $row->size_bytes) {
                $this->dropStaging($staging);
                throw new FileNodeSetError(['type' => 'serverFail', 'description' => 'The staged copy does not match the blob; repeat this FileNode/set.']);
            }
            if ($placing !== null) {
                $placing();
            }
            if (! $files->move($staging->staging_key, $targetKey)) {
                throw new \RuntimeException('Could not place the copied file.');
            }
            $staging->delete();
        } catch (\Throwable $e) {
            JmapAttachStaging::query()->where('id', $staging->id)->where('lease_token', $token)
                ->update(['locked_until' => null, 'lease_token' => null]);
            throw $e;
        }

        // Staged across calls: the bytes are the stored blob's, whose sha256
        // was computed when it was written.
        return ['sha256' => $row->sha256, 'size' => $row->size_bytes];
    }

    /**
     * @return array{sha256: string, size: int}
     */
    private function copyInOneStep(string $username, JmapBlob $row, string $targetKey, ?\Closure $placing): array
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
            if ($placing !== null) {
                $placing();
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

    /**
     * Takes the staging row's lease (creating the row on the first call), or
     * answers attachInProgress while another call holds it: two calls that
     * truncate and append the same range would interleave their bytes.
     */
    private function leaseStaging(string $username, JmapBlob $row, string $targetKey, ?JmapAttachStaging $staging): JmapAttachStaging
    {
        $token = Str::random(32);
        $until = Carbon::now()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5);
        if ($staging === null) {
            try {
                return JmapAttachStaging::query()->create([
                    'username' => $username,
                    'blob_id' => $row->blob_id,
                    'target_hash' => hash('sha256', $targetKey),
                    'target_key' => $targetKey,
                    'staging_key' => $this->stagingKey($username),
                    'size_bytes' => $row->size_bytes,
                    'copied_bytes' => 0,
                    'locked_until' => $until,
                    'lease_token' => $token,
                ]);
            } catch (QueryException) {
                // A concurrent first call created it (unique index).
                throw $this->stagingBusy(0, $row->size_bytes);
            }
        }
        $now = Carbon::now();
        $taken = JmapAttachStaging::query()->where('id', $staging->id)
            ->where(function ($query) use ($now): void {
                $query->whereNull('locked_until')->orWhere('locked_until', '<', $now);
            })
            ->update(['locked_until' => $until, 'lease_token' => $token]);
        if ($taken !== 1) {
            throw $this->stagingBusy($staging->copied_bytes, $row->size_bytes);
        }
        // Re-read: the holder before us may have advanced copied_bytes.
        $fresh = JmapAttachStaging::query()->findOrFail($staging->id);

        return $fresh;
    }

    private function stagingBusy(int $copied, int $size): FileNodeSetError
    {
        return new FileNodeSetError([
            'type' => 'attachInProgress',
            'description' => 'The file is still being copied; repeat this FileNode/set.',
            'copied' => $copied,
            'size' => $size,
        ]);
    }

    private function dropStaging(JmapAttachStaging $staging): void
    {
        $this->blobs->deleteQuietly($this->storage->files(), $staging->staging_key);
        $staging->delete();
    }

    private function stagingKey(string $username): string
    {
        // Outside users/ and groups/: never indexed, never listed over DAV,
        // and on the same disk as the target so placing it is a rename.
        return self::STAGING_ROOT.'/'.$username.'/'.Str::lower(Str::random(32));
    }
}

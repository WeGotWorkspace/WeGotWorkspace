<?php

declare(strict_types=1);

namespace App\Services\Jmap\Assembly;

use App\Database\GuardedUpdate;
use App\Models\JmapBlobAssembly;
use App\Models\JmapBlobAssemblyPart;
use App\Services\Jmap\Blobs\FreeSpaceSource;
use App\Services\Jmap\Blobs\HashStateCodec;
use App\Services\Jmap\Blobs\JmapBlobLimits;
use App\Services\Jmap\Blobs\JmapBlobReferenceGuard;
use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\Blobs\StorageFullException;
use App\Services\Jmap\JmapMethodException;
use App\Storage\Local\LocalDiskFiles;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Blob assembly extension (#1500, https://wegotworkspace.org/jmap/blob-assembly).
 *
 * RFC 9404 creates a new, immutable blob in one Blob/upload, so stepwise
 * assembly cannot happen inside it. An assembly has its own id, declared
 * length, and TTL; the client appends parts in order, each call within the
 * step budget, and finishes it into one ordinary `jb-` blob whose id is the
 * true sha256 of the bytes — the same id the file gets uploaded in one
 * piece.
 *
 * The running sha256 is a serialized HashContext stored between calls.
 * Whenever it cannot be read back (corrupt, another PHP build, not a
 * HashContext) the hash is rebuilt by streaming the bytes assembled so far,
 * one budget per call; the assembly itself is never discarded.
 */
final class BlobAssemblyService
{
    public const STATUS_OPEN = 'open';

    public const STATUS_FINISHED = 'finished';

    private const ID_PATTERN = '/^ba-[0-9a-f]{32}$/';

    public function __construct(
        private readonly WgwStorage $storage,
        private readonly JmapBlobService $blobs,
        private readonly LocalDiskFiles $local,
        private readonly FreeSpaceSource $freeSpace,
        private readonly BlobClaimService $claims,
        private readonly JmapBlobReferenceGuard $references,
    ) {}

    /**
     * @return array<string, mixed> the created object, or a SetError (key `type`)
     */
    public function create(string $username, mixed $size, mixed $type): array
    {
        if (! is_int($size) || $size < 0) {
            return ['type' => 'invalidProperties', 'description' => 'size must be an UnsignedInt.', 'properties' => ['size']];
        }
        if ($type !== null && ! is_string($type)) {
            return ['type' => 'invalidProperties', 'description' => 'type must be a string or null.', 'properties' => ['type']];
        }
        $max = JmapBlobLimits::maxSizeBlobSet();
        if ($max !== null && $size > $max) {
            return ['type' => 'tooLarge', 'description' => 'size exceeds maxSizeAssembly.', 'maxSize' => $max];
        }
        $free = $this->freeSpace->freeBytes($this->storage->data());
        if ($free !== null && $size > $free) {
            return ['type' => 'overQuota', 'description' => 'Not enough free space for this assembly.'];
        }

        $id = 'ba-'.Str::lower(Str::replace('-', '', Str::uuid()->toString()));
        $encoded = HashStateCodec::encode(hash_init('sha256'));
        $row = JmapBlobAssembly::query()->create([
            'assembly_id' => $id,
            'username' => $username,
            'media_type' => is_string($type) && trim($type) !== '' ? trim($type) : null,
            'size_bytes' => $size,
            'received_bytes' => 0,
            'next_index' => 0,
            'hashed_bytes' => 0,
            'hash_state' => $encoded['state'],
            'hash_build' => $encoded['build'],
            'status' => self::STATUS_OPEN,
            'expires_at' => Carbon::now()->addSeconds(JmapBlobLimits::assemblyTtlSeconds()),
        ]);
        $this->local->truncate($this->storage->data(), $this->fileKey($row), 0);

        return ['id' => $id, 'size' => $size, 'type' => $row->media_type, 'expires' => $this->utc($row->expires_at)];
    }

    /**
     * @param  list<array{index: int, blobId: string}>  $parts  validated, ascending by index
     * @return array<string, mixed>
     */
    public function append(string $username, string $id, array $parts): array
    {
        $row = $this->openAssembly($username, $id);
        $this->guardPartsShape($row, $parts);

        return $this->withLease($row, function (JmapBlobAssembly $row, string $lease) use ($parts): array {
            $this->reconcileFile($row);
            [$accepted, $fresh] = $this->splitAccepted($row, $parts);

            $sizes = $this->freshPartSizes($row, $fresh);
            $total = array_sum($sizes);
            if ($row->received_bytes + $total > $row->size_bytes) {
                throw new JmapMethodException('invalidArguments', 'The parts exceed the declared size of the assembly.');
            }
            $budget = JmapBlobLimits::stepBudgetBytes();
            if ($total > $budget) {
                throw new JmapMethodException('requestTooLarge', 'The parts exceed stepBudgetBytes; append fewer parts per call.', ['limit' => 'stepBudgetBytes']);
            }

            [$context, $budget, $rebuildPending, $rebuilt] = $this->rebuildStep($row, $budget, $lease);
            if ($rebuildPending) {
                return $this->appendResponse($row, $accepted, rebuiltOnly: true, rebuildPending: true);
            }

            $consumed = [];
            $newRows = [];
            $received = $row->received_bytes;
            $nextIndex = $row->next_index;
            foreach ($fresh as $i => $part) {
                $partSize = $sizes[$i];
                if ($partSize > $budget) {
                    break;
                }
                $this->appendPart($row, $part['blobId'], $partSize, $context, $received, $lease);
                $budget -= $partSize;
                $received += $partSize;
                $nextIndex = $part['index'] + 1;
                $accepted[] = $part['index'];
                $consumed[] = $part['blobId'];
                $newRows[] = ['assembly_id' => $row->assembly_id, 'part_index' => $part['index'], 'blob_id' => $part['blobId'], 'size_bytes' => $partSize];
            }

            $encoded = HashStateCodec::encode($context);
            DB::connection('wgw')->transaction(function () use ($row, $lease, $received, $nextIndex, $encoded, $newRows): void {
                $row->received_bytes = $received;
                $row->next_index = $nextIndex;
                $row->hashed_bytes = $received;
                $row->hash_state = $encoded['state'];
                $row->hash_build = $encoded['build'];
                $row->expires_at = Carbon::now()->addSeconds(JmapBlobLimits::assemblyTtlSeconds());
                $this->saveHeld($row, $lease);
                foreach ($newRows as $newRow) {
                    JmapBlobAssemblyPart::query()->create($newRow);
                }
            });
            $this->releaseConsumedParts($row, $consumed, $parts);

            return $this->appendResponse($row, $accepted, rebuiltOnly: $rebuilt && $consumed === [], rebuildPending: false);
        });
    }

    /**
     * @return array<string, mixed>
     */
    public function finish(string $username, string $id): array
    {
        $row = $this->findAssembly($username, $id);
        if ($row === null) {
            throw new JmapMethodException('invalidArguments', 'Unknown or expired assembly.');
        }
        if ($row->status === self::STATUS_FINISHED) {
            return $this->finishResponse($row);
        }
        $this->guardOpen($row);

        return $this->withLease($row, function (JmapBlobAssembly $row, string $lease): array {
            if ($row->received_bytes !== $row->size_bytes) {
                throw new JmapMethodException('invalidArguments', sprintf('The assembly holds %d of %d octets.', $row->received_bytes, $row->size_bytes));
            }
            if ($row->final_sha256 === null) {
                $this->reconcileFile($row);
                [$context, , $rebuildPending] = $this->rebuildStep($row, JmapBlobLimits::stepBudgetBytes(), $lease);
                if ($rebuildPending) {
                    return $this->finishResponse($row, rebuildPending: true);
                }
                // A finalized HashContext cannot be updated or finalized
                // again (TypeError): store the hex before committing, so a
                // retried finish reuses it.
                $row->final_sha256 = hash_final($context);
                $row->hash_state = null;
                $this->saveHeld($row, $lease);
            }

            $stored = $this->blobs->commitFile(
                $row->username,
                $row->media_type ?? 'application/octet-stream',
                $this->fileKey($row),
                (string) $row->final_sha256,
                $row->size_bytes,
            );
            DB::connection('wgw')->transaction(function () use ($row, $lease, $stored): void {
                $row->status = self::STATUS_FINISHED;
                $row->blob_id = $stored['blobId'];
                $row->expires_at = Carbon::now()->addHours(JmapBlobLimits::blobTtlHours());
                $this->saveHeld($row, $lease);
                JmapBlobAssemblyPart::query()->where('assembly_id', $row->assembly_id)->delete();
            });
            $this->claims->release($row->assembly_id);

            return $this->finishResponse($row);
        });
    }

    /**
     * @param  list<string>|null  $ids
     * @return array{list: list<array<string, mixed>>, notFound: list<string>}
     */
    public function get(string $username, ?array $ids): array
    {
        $query = JmapBlobAssembly::query()->where('username', $username)->where('expires_at', '>', Carbon::now());
        if ($ids !== null) {
            $query->whereIn('assembly_id', $ids);
        }
        $list = [];
        $found = [];
        foreach ($query->orderBy('id')->get() as $row) {
            $list[] = $this->toObject($row);
            $found[] = $row->assembly_id;
        }

        return ['list' => $list, 'notFound' => $ids === null ? [] : array_values(array_diff($ids, $found))];
    }

    public function destroy(string $username, string $id): bool
    {
        $row = $this->findAssembly($username, $id);
        if ($row === null) {
            return false;
        }
        if ($this->takeLease($row) === null) {
            throw new JmapMethodException('serverUnavailable', 'Another call is working on this assembly; retry shortly.');
        }
        $this->discard($row);

        return true;
    }

    /**
     * Drops assemblies past their TTL: open ones release their file and
     * claims, finished ones only their row. Bounded per call.
     */
    public function expire(int $limit = 50): int
    {
        $rows = JmapBlobAssembly::query()
            ->where('expires_at', '<', Carbon::now())
            ->orderBy('id')
            ->limit($limit)
            ->get();
        foreach ($rows as $row) {
            // An append still holds the lease: leave the row for the next run.
            if ($this->takeLease($row) !== null) {
                $this->discard($row);
            }
        }

        return $rows->count();
    }

    /**
     * @return array<string, mixed>
     */
    public function toObject(JmapBlobAssembly $row): array
    {
        $parts = $row->status === self::STATUS_OPEN
            ? JmapBlobAssemblyPart::query()->where('assembly_id', $row->assembly_id)->orderBy('part_index')->pluck('part_index')->map(intval(...))->all()
            : [];

        return [
            'id' => $row->assembly_id,
            'size' => $row->size_bytes,
            'type' => $row->media_type,
            'received' => $row->received_bytes,
            'nextIndex' => $row->next_index,
            'acceptedParts' => array_values($parts),
            'hashRebuildPending' => $row->status === self::STATUS_OPEN && $this->needsRebuild($row),
            'status' => $row->status,
            'blobId' => $row->blob_id,
            'expires' => $this->utc($row->expires_at),
        ];
    }

    // ---------------------------------------------------------------

    private function discard(JmapBlobAssembly $row): void
    {
        $this->blobs->deleteQuietly($this->storage->data(), $this->fileKey($row));
        JmapBlobAssemblyPart::query()->where('assembly_id', $row->assembly_id)->delete();
        $this->claims->release($row->assembly_id);
        $row->delete();
    }

    private function findAssembly(string $username, string $id): ?JmapBlobAssembly
    {
        if (preg_match(self::ID_PATTERN, $id) !== 1) {
            return null;
        }
        $row = JmapBlobAssembly::query()->where('assembly_id', $id)->where('username', $username)->first();
        if ($row === null || $row->expires_at->isPast()) {
            return null;
        }

        return $row;
    }

    private function openAssembly(string $username, string $id): JmapBlobAssembly
    {
        $row = $this->findAssembly($username, $id);
        if ($row === null) {
            throw new JmapMethodException('invalidArguments', 'Unknown or expired assembly.');
        }
        $this->guardOpen($row);

        return $row;
    }

    private function guardOpen(JmapBlobAssembly $row): void
    {
        if ($row->status !== self::STATUS_OPEN) {
            throw new JmapMethodException('invalidArguments', 'The assembly is already finished.');
        }
    }

    /**
     * @param  list<array{index: int, blobId: string}>  $parts
     */
    private function guardPartsShape(JmapBlobAssembly $row, array $parts): void
    {
        $previous = null;
        foreach ($parts as $part) {
            if ($previous !== null && $part['index'] !== $previous + 1) {
                throw new JmapMethodException('invalidArguments', 'parts must have consecutive ascending indexes.');
            }
            $previous = $part['index'];
        }
        if ($parts !== [] && $parts[0]['index'] > $row->next_index) {
            throw new JmapMethodException('invalidArguments', sprintf('Parts must be appended in order; the next index is %d.', $row->next_index));
        }
    }

    /**
     * Splits the request into indexes already accepted (a retried call: a
     * no-op that still reports them) and the parts still to append.
     *
     * @param  list<array{index: int, blobId: string}>  $parts
     * @return array{0: list<int>, 1: list<array{index: int, blobId: string}>}
     */
    private function splitAccepted(JmapBlobAssembly $row, array $parts): array
    {
        $known = JmapBlobAssemblyPart::query()
            ->where('assembly_id', $row->assembly_id)
            ->where('part_index', '<', $row->next_index)
            ->pluck('blob_id', 'part_index')
            ->all();
        $accepted = [];
        $fresh = [];
        foreach ($parts as $part) {
            if ($part['index'] < $row->next_index) {
                if (($known[$part['index']] ?? null) !== $part['blobId']) {
                    throw new JmapMethodException('invalidArguments', sprintf('Part %d was already accepted with another blobId.', $part['index']));
                }
                $accepted[] = $part['index'];

                continue;
            }
            $fresh[] = $part;
        }

        return [$accepted, $fresh];
    }

    /**
     * Sizes of the parts still to append; every missing part is reported
     * at once (blobNotFound + notFound) and nothing is appended.
     *
     * @param  list<array{index: int, blobId: string}>  $fresh
     * @return list<int>
     */
    private function freshPartSizes(JmapBlobAssembly $row, array $fresh): array
    {
        $sizes = [];
        $missing = [];
        foreach ($fresh as $part) {
            $blob = $this->blobs->find($row->username, $part['blobId']);
            if ($blob === null) {
                $missing[] = $part['blobId'];

                continue;
            }
            $sizes[] = $blob->size_bytes;
        }
        if ($missing !== []) {
            throw new JmapMethodException('blobNotFound', 'One or more parts are unknown or expired; upload them again.', ['notFound' => array_values(array_unique($missing))]);
        }

        return $sizes;
    }

    /**
     * Restores the running hash, or rebuilds it from the assembled bytes
     * within the budget (storing a fresh state after the step).
     *
     * @return array{0: \HashContext, 1: int, 2: bool, 3: bool} context, budget left, rebuild still pending, rebuild advanced in this call
     */
    private function rebuildStep(JmapBlobAssembly $row, int $budget, string $lease): array
    {
        [$context, $hashed] = StepHasher::resume($row->hash_state, $row->hash_build, $row->hashed_bytes);
        if ($hashed > $row->received_bytes) {
            [$context, $hashed] = [hash_init('sha256'), 0];
        }
        if ($hashed === $row->received_bytes) {
            return [$context, $budget, false, false];
        }

        $offset = StepHasher::advance($this->storage->data(), $this->fileKey($row), $context, $hashed, $row->received_bytes, $budget);
        if ($offset === $hashed) {
            throw new \RuntimeException('The assembly file is shorter than its received length.');
        }
        $budget -= $offset - $hashed;
        $encoded = HashStateCodec::encode($context);
        $row->hashed_bytes = $offset;
        $row->hash_state = $encoded['state'];
        $row->hash_build = $encoded['build'];
        $this->saveHeld($row, $lease);

        return [$context, $budget, $offset < $row->received_bytes, true];
    }

    private function needsRebuild(JmapBlobAssembly $row): bool
    {
        if ($row->final_sha256 !== null) {
            return false;
        }
        [, $hashed] = StepHasher::resume($row->hash_state, $row->hash_build, $row->hashed_bytes);

        return $hashed !== $row->received_bytes;
    }

    private function appendPart(JmapBlobAssembly $row, string $blobId, int $size, \HashContext $context, int $received, string $lease): void
    {
        $disk = $this->storage->data();
        $source = $this->blobs->openStream($row->username, $blobId);
        if ($source === null) {
            throw new JmapMethodException('blobNotFound', 'A part vanished while appending; upload it again.', ['notFound' => [$blobId]]);
        }
        try {
            // Renew before the first byte: the lease may be nearly spent
            // after a long rebuild step, and a lost lease must stop us here.
            $this->renewLease($row, $lease);
            $renewedAt = time();
            $written = $this->local->append($disk, $this->fileKey($row), $source, $size, function (string $chunk) use ($context, $row, $lease, &$renewedAt): void {
                hash_update($context, $chunk);
                // Disk time is not counted by max_execution_time: keep the
                // lease alive while bytes flow, and stop if it was lost.
                if (time() - $renewedAt >= 5) {
                    $renewedAt = time();
                    $this->renewLease($row, $lease);
                }
            });
        } catch (StorageFullException $e) {
            $this->local->truncate($disk, $this->fileKey($row), $received);
            throw $e;
        } finally {
            fclose($source);
        }
        if ($written !== $size) {
            $this->local->truncate($disk, $this->fileKey($row), $received);
            throw new \RuntimeException('A part was shorter than its stored size.');
        }
    }

    /**
     * Drops bytes an interrupted step wrote past the recorded length, so a
     * retried append never glues a part twice.
     */
    private function reconcileFile(JmapBlobAssembly $row): void
    {
        $disk = $this->storage->data();
        $onDisk = $this->local->size($disk, $this->fileKey($row));
        if ($onDisk === null && $row->received_bytes === 0) {
            $this->local->truncate($disk, $this->fileKey($row), 0);

            return;
        }
        if ($onDisk === null || $onDisk < $row->received_bytes) {
            throw new \RuntimeException('The assembly file lost bytes.');
        }
        if ($onDisk > $row->received_bytes) {
            $this->local->truncate($disk, $this->fileKey($row), $row->received_bytes);
        }
    }

    /**
     * Parts are deleted as they are appended (peak disk ~1× the file),
     * unless the same blobId comes back later in this call or a reference
     * checker (another assembly's claim, an attach in progress) vetoes it.
     *
     * @param  list<string>  $consumed
     * @param  list<array{index: int, blobId: string}>  $parts
     */
    private function releaseConsumedParts(JmapBlobAssembly $row, array $consumed, array $parts): void
    {
        if ($consumed === []) {
            return;
        }
        $this->claims->release($row->assembly_id, $consumed);
        $acceptedThrough = $row->next_index - 1;
        $neededLater = [];
        foreach ($parts as $part) {
            if ($part['index'] > $acceptedThrough) {
                $neededLater[$part['blobId']] = true;
            }
        }
        foreach (array_unique($consumed) as $blobId) {
            if (isset($neededLater[$blobId]) || $this->references->isReferenced($row->username, $blobId)) {
                continue;
            }
            $this->blobs->delete($row->username, $blobId);
        }
    }

    /**
     * Serializes calls on one assembly with a lease taken by one
     * conditional UPDATE (no transaction is held open during I/O). The lease
     * has an owner: it is released, renewed and committed against only while
     * this call's token is still the stored one.
     *
     * @template T
     *
     * @param  callable(JmapBlobAssembly, string): T  $work
     * @return T
     */
    private function withLease(JmapBlobAssembly $row, callable $work): mixed
    {
        $token = $this->takeLease($row);
        if ($token === null) {
            throw new JmapMethodException('serverUnavailable', 'Another call is working on this assembly; retry shortly.');
        }
        try {
            $fresh = JmapBlobAssembly::query()->findOrFail($row->id);

            return $work($fresh, $token);
        } finally {
            JmapBlobAssembly::query()->where('id', $row->id)->where('lease_token', $token)
                ->update(['locked_until' => null, 'lease_token' => null]);
        }
    }

    private function takeLease(JmapBlobAssembly $row): ?string
    {
        $now = Carbon::now();
        $token = Str::random(32);
        $taken = JmapBlobAssembly::query()
            ->where('id', $row->id)
            ->where(function ($query) use ($now): void {
                $query->whereNull('locked_until')->orWhere('locked_until', '<', $now);
            })
            ->update(['locked_until' => $now->copy()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5), 'lease_token' => $token]);

        return $taken === 1 ? $token : null;
    }

    private function renewLease(JmapBlobAssembly $row, string $token): void
    {
        $held = GuardedUpdate::matched(
            JmapBlobAssembly::query()->where('id', $row->id)->where('lease_token', $token),
            ['locked_until' => Carbon::now()->addSeconds(JmapBlobLimits::timeLimitSeconds() + 5)],
        );
        if (! $held) {
            throw new JmapMethodException('serverUnavailable', 'The lease on this assembly was lost; retry.');
        }
    }

    /**
     * Saves the row only while this call still owns the lease; otherwise
     * nothing is written and the caller must not report success.
     */
    private function saveHeld(JmapBlobAssembly $row, string $token): void
    {
        $dirty = $row->getDirty();
        if ($dirty === []) {
            return;
        }
        if (! GuardedUpdate::matched(JmapBlobAssembly::query()->where('id', $row->id)->where('lease_token', $token), $dirty)) {
            throw new JmapMethodException('serverUnavailable', 'The lease on this assembly was lost; retry.');
        }
        $row->syncOriginal();
    }

    /**
     * @param  list<int>  $accepted
     * @return array<string, mixed>
     */
    private function appendResponse(JmapBlobAssembly $row, array $accepted, bool $rebuiltOnly, bool $rebuildPending): array
    {
        sort($accepted);

        return [
            'id' => $row->assembly_id,
            'accepted' => array_values(array_unique($accepted)),
            'rebuiltOnly' => $rebuiltOnly,
            'hashRebuildPending' => $rebuildPending,
            'received' => $row->received_bytes,
            'nextIndex' => $row->next_index,
            'expires' => $this->utc($row->expires_at),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function finishResponse(JmapBlobAssembly $row, bool $rebuildPending = false): array
    {
        return [
            'id' => $row->assembly_id,
            'blobId' => $row->status === self::STATUS_FINISHED ? $row->blob_id : null,
            'size' => $row->size_bytes,
            'type' => $row->media_type ?? 'application/octet-stream',
            'hashRebuildPending' => $rebuildPending,
        ];
    }

    private function fileKey(JmapBlobAssembly $row): string
    {
        return 'jmap/assemblies/'.$row->username.'/'.$row->assembly_id;
    }

    private function utc(Carbon $time): string
    {
        return $time->copy()->utc()->format('Y-m-d\TH:i:s\Z');
    }
}

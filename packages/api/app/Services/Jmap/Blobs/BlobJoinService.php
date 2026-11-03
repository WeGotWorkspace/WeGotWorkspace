<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Services\Jmap\JmapMethodException;
use App\Storage\Local\LocalDiskFiles;
use App\Storage\WgwStorage;

/**
 * RFC 9404 Blob/upload (#1500): each creation joins its data sources into
 * one new blob — `{blobId, offset?, length?}` streamed from a stored blob,
 * `data:asText` and `data:asBase64` from the request (bounded by
 * maxSizeRequest). The new id and sha256 are the true sha256 of the joined
 * bytes, computed while joining (each source is read once).
 *
 * The whole call must fit in one step budget: that is checked before a
 * byte is written, because running into max_execution_time is a fatal
 * error PHP cannot turn into a JMAP response.
 */
final class BlobJoinService
{
    private const SOURCE_KEYS = ['data:asText', 'data:asBase64', 'blobId', 'offset', 'length'];

    public function __construct(
        private readonly WgwStorage $storage,
        private readonly JmapBlobService $blobs,
        private readonly LocalDiskFiles $local,
        private readonly FreeSpaceSource $freeSpace,
    ) {}

    /**
     * @param  array<string, mixed>  $create
     * @return array{created: array<string, array<string, mixed>>, notCreated: array<string, array<string, mixed>>}
     */
    public function upload(string $username, array $create): array
    {
        $plans = [];
        $notCreated = [];
        foreach ($create as $creationId => $upload) {
            $plan = $this->plan($username, $upload);
            if (isset($plan['error'])) {
                $notCreated[(string) $creationId] = $plan['error'];

                continue;
            }
            $plans[(string) $creationId] = $plan;
        }

        $total = array_sum(array_map(static fn (array $plan): int => $plan['size'], $plans));
        if ($total > JmapBlobLimits::stepBudgetBytes()) {
            throw new JmapMethodException('requestTooLarge', 'The data sources exceed what one call can join within the step budget; use the blob assembly extension.', ['limit' => 'stepBudgetBytes']);
        }

        $created = [];
        $free = $this->freeSpace->freeBytes($this->storage->data());
        foreach ($plans as $creationId => $plan) {
            if ($free !== null && $plan['size'] > $free) {
                // Parts already stored are already off the free space; only
                // the bytes this blob adds count.
                $notCreated[$creationId] = ['type' => 'overQuota', 'description' => 'Not enough free space for this blob.'];

                continue;
            }
            $stored = $this->join($username, $plan);
            if ($free !== null) {
                $free -= $plan['size'];
            }
            $created[$creationId] = ['id' => $stored['blobId'], 'type' => $stored['type'], 'size' => $stored['size']];
        }

        return ['created' => $created, 'notCreated' => $notCreated];
    }

    /**
     * Validates one UploadObject without reading blob bytes.
     *
     * @return array{size: int, type: string, sources: list<array{kind: string, value: string, offset: int, length: int}>}|array{error: array<string, mixed>}
     */
    private function plan(string $username, mixed $upload): array
    {
        if (! is_array($upload) || ! is_array($upload['data'] ?? null) || ! array_is_list($upload['data']) || $upload['data'] === []) {
            return ['error' => $this->invalid('data must be a non-empty array of DataSourceObjects.', ['data'])];
        }
        $unknown = array_diff(array_keys($upload), ['data', 'type']);
        if ($unknown !== []) {
            return ['error' => $this->invalid('Unknown UploadObject properties.', array_values(array_map(strval(...), $unknown)))];
        }
        $type = $upload['type'] ?? null;
        if ($type !== null && ! is_string($type)) {
            return ['error' => $this->invalid('type must be a string or null.', ['type'])];
        }
        if (count($upload['data']) > JmapBlobLimits::maxDataSources()) {
            return ['error' => ['type' => 'tooLarge', 'description' => 'More data sources than maxDataSources.']];
        }

        $sources = [];
        $missing = [];
        $size = 0;
        foreach ($upload['data'] as $i => $source) {
            $parsed = $this->source($username, $source, $i);
            if (isset($parsed['error'])) {
                return ['error' => $parsed['error']];
            }
            if (isset($parsed['missing'])) {
                $missing[] = $parsed['missing'];

                continue;
            }
            $sources[] = $parsed;
            $size += $parsed['length'];
        }
        if ($missing !== []) {
            // RFC 9404 defines no type for an unknown source; this follows
            // RFC 8621's blobNotFound so the client re-uploads just those.
            return ['error' => [
                'type' => 'blobNotFound',
                'description' => 'One or more source blobs are unknown or expired.',
                'notFound' => array_values(array_unique($missing)),
            ]];
        }
        $max = JmapBlobLimits::maxSizeBlobSet();
        if ($max !== null && $size > $max) {
            return ['error' => ['type' => 'tooLarge', 'description' => 'The blob would exceed maxSizeBlobSet.', 'maxSize' => $max]];
        }

        return ['size' => $size, 'type' => is_string($type) && trim($type) !== '' ? trim($type) : 'application/octet-stream', 'sources' => $sources];
    }

    /**
     * @return array{kind: string, value: string, offset: int, length: int}|array{missing: string}|array{error: array<string, mixed>}
     */
    private function source(string $username, mixed $source, int $index): array
    {
        $property = 'data/'.$index;
        if (! is_array($source) || array_diff(array_keys($source), self::SOURCE_KEYS) !== []) {
            return ['error' => $this->invalid('Invalid DataSourceObject.', [$property])];
        }
        $forms = array_intersect(array_keys($source), ['data:asText', 'data:asBase64', 'blobId']);
        if (count($forms) !== 1) {
            return ['error' => $this->invalid('A DataSourceObject has exactly one of data:asText, data:asBase64, blobId.', [$property])];
        }

        if (array_key_exists('data:asText', $source)) {
            $text = $source['data:asText'];
            if (! is_string($text) || ! mb_check_encoding($text, 'UTF-8') || isset($source['offset']) || isset($source['length'])) {
                return ['error' => $this->invalid('data:asText must be a UTF-8 string.', [$property])];
            }

            return ['kind' => 'bytes', 'value' => $text, 'offset' => 0, 'length' => strlen($text)];
        }
        if (array_key_exists('data:asBase64', $source)) {
            $decoded = is_string($source['data:asBase64']) ? base64_decode($source['data:asBase64'], true) : false;
            if ($decoded === false || isset($source['offset']) || isset($source['length'])) {
                return ['error' => $this->invalid('data:asBase64 must be valid base64.', [$property])];
            }

            return ['kind' => 'bytes', 'value' => $decoded, 'offset' => 0, 'length' => strlen($decoded)];
        }

        $blobId = $source['blobId'];
        $offset = $source['offset'] ?? null;
        $length = $source['length'] ?? null;
        if (! is_string($blobId) || ($offset !== null && (! is_int($offset) || $offset < 0)) || ($length !== null && (! is_int($length) || $length < 0))) {
            return ['error' => $this->invalid('blobId must be an id; offset and length UnsignedInt or null.', [$property])];
        }
        $row = $this->blobs->find($username, $blobId);
        if ($row === null) {
            return ['missing' => $blobId];
        }
        $offset ??= 0;
        $available = $row->size_bytes - $offset;
        $length ??= max(0, $available);
        if ($offset > $row->size_bytes || $length > $available) {
            // RFC 9404 §4.1: a range past the end makes the source invalid.
            return ['error' => $this->invalid('offset/length go past the end of the source blob.', [$property])];
        }

        return ['kind' => 'blob', 'value' => $blobId, 'offset' => $offset, 'length' => $length];
    }

    /**
     * @param  array{size: int, type: string, sources: list<array{kind: string, value: string, offset: int, length: int}>}  $plan
     * @return array{blobId: string, type: string, size: int, sha256: string}
     */
    private function join(string $username, array $plan): array
    {
        $disk = $this->storage->data();
        $tmpKey = $this->blobs->tmpKey($username);
        $context = hash_init('sha256');
        $onChunk = static function (string $chunk) use ($context): void {
            hash_update($context, $chunk);
        };
        try {
            $this->local->truncate($disk, $tmpKey, 0);
            foreach ($plan['sources'] as $source) {
                $this->appendSource($username, $tmpKey, $source, $onChunk);
            }
        } catch (\Throwable $e) {
            $this->blobs->deleteQuietly($disk, $tmpKey);
            throw $e;
        }

        return $this->blobs->commitFile($username, $plan['type'], $tmpKey, hash_final($context), $plan['size']);
    }

    /**
     * @param  array{kind: string, value: string, offset: int, length: int}  $source
     * @param  callable(string): void  $onChunk
     */
    private function appendSource(string $username, string $tmpKey, array $source, callable $onChunk): void
    {
        if ($source['length'] === 0) {
            return;
        }
        $stream = $source['kind'] === 'bytes'
            ? LocalDiskFiles::tempStream($source['value'])
            : $this->blobs->openStream($username, $source['value']);
        if ($stream === null) {
            throw new JmapMethodException('serverFail', 'A source blob vanished while joining.');
        }
        try {
            if ($source['offset'] > 0 && fseek($stream, $source['offset']) !== 0) {
                throw new \RuntimeException('Could not seek in a source blob.');
            }
            $written = $this->local->append($this->storage->data(), $tmpKey, $stream, $source['length'], $onChunk);
        } finally {
            fclose($stream);
        }
        if ($written !== $source['length']) {
            throw new \RuntimeException('A source blob was shorter than its stored size.');
        }
    }

    /**
     * @param  list<string>  $properties
     * @return array<string, mixed>
     */
    private function invalid(string $description, array $properties): array
    {
        return ['type' => 'invalidProperties', 'description' => $description, 'properties' => $properties];
    }
}

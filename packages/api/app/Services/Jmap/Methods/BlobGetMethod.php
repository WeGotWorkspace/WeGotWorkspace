<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Blobs\JmapBlobService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * Blob/get (RFC 9404 §4.2, #1500) at its minimum: `id` and `size` of
 * uploaded `jb-` blobs. `data*`, `digest:*`, `isEncodingProblem`, and
 * `isTruncated` are not served (non-goal; supportedDigestAlgorithms is
 * empty) — naming one is invalidArguments, and bytes come from the
 * Session's downloadUrl. Documented deviation: an omitted `properties`
 * means `["id", "size"]`, not RFC 9404's default of `data` and `size`.
 */
final class BlobGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    private const SERVED = ['id', 'size'];

    public function __construct(private readonly JmapBlobService $blobs) {}

    public function name(): string
    {
        return 'Blob/get';
    }

    public function capability(): string
    {
        return JmapCapabilities::BLOB;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $ids = $this->requestedIds($args);
        if ($ids === null) {
            throw new JmapMethodException('invalidArguments', 'Blob/get needs explicit ids.');
        }
        $properties = $args['properties'] ?? null;
        if ($properties !== null) {
            if (! is_array($properties) || ! array_is_list($properties)) {
                throw new JmapMethodException('invalidArguments', 'properties must be null or an array of names.');
            }
            $unserved = array_values(array_diff($properties, self::SERVED));
            if ($unserved !== []) {
                throw new JmapMethodException('invalidArguments', sprintf(
                    'Blob/get serves only id and size; download the bytes through downloadUrl (unsupported: %s).',
                    implode(', ', array_map(static fn (mixed $p): string => is_string($p) ? $p : gettype($p), $unserved)),
                ));
            }
        }
        foreach (['offset', 'length'] as $key) {
            if (($args[$key] ?? null) !== null && (! is_int($args[$key]) || $args[$key] < 0)) {
                throw new JmapMethodException('invalidArguments', $key.' must be an UnsignedInt or null.');
            }
        }

        $list = [];
        $notFound = [];
        foreach ($ids as $id) {
            $row = $this->blobs->find($username, $id);
            if ($row === null) {
                $notFound[] = $id;

                continue;
            }
            $item = ['id' => $id, 'size' => $row->size_bytes];
            if ($properties !== null && ! in_array('size', $properties, true)) {
                unset($item['size']);
            }
            $list[] = $item;
        }

        return ['accountId' => $username, 'list' => $list, 'notFound' => $notFound];
    }
}

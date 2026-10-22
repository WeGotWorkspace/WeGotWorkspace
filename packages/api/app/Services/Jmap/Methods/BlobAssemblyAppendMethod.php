<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Assembly\BlobAssemblyService;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * BlobAssembly/append (WGW extension, #1500): `{accountId, id, parts:
 * [{index, blobId}]}`. Appends parts in order within stepBudgetBytes and
 * reports which indexes are accepted (a retried index is a no-op that is
 * reported as accepted) and whether the call only advanced a hash rebuild.
 */
final class BlobAssemblyAppendMethod implements JmapMethodInterface
{
    public function __construct(private readonly BlobAssemblyService $assemblies) {}

    public function name(): string
    {
        return 'BlobAssembly/append';
    }

    public function capability(): string
    {
        return JmapCapabilities::BLOB_ASSEMBLY;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $id = $args['id'] ?? null;
        if (! is_string($id) || $id === '') {
            throw new JmapMethodException('invalidArguments', 'id is required.');
        }
        $rawParts = $args['parts'] ?? null;
        if (! is_array($rawParts) || ! array_is_list($rawParts)) {
            throw new JmapMethodException('invalidArguments', 'parts must be an array of {index, blobId}.');
        }
        $parts = [];
        foreach ($rawParts as $part) {
            if (! is_array($part)
                || ! is_int($part['index'] ?? null) || $part['index'] < 0
                || ! is_string($part['blobId'] ?? null) || $part['blobId'] === ''
                || array_diff(array_keys($part), ['index', 'blobId']) !== []) {
                throw new JmapMethodException('invalidArguments', 'Each part must be {index: UnsignedInt, blobId: Id}.');
            }
            $parts[] = ['index' => $part['index'], 'blobId' => $part['blobId']];
        }

        return ['accountId' => $username] + $this->assemblies->append($username, $id, $parts);
    }
}

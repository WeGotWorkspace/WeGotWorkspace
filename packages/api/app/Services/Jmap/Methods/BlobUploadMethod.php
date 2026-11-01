<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\Blobs\BlobJoinService;
use App\Services\Jmap\Blobs\JmapBlobMaintenance;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * Blob/upload (RFC 9404 §4.1, #1500): join data sources into one new blob
 * usable in FileNode/set like any uploaded blob. Large files use the blob
 * assembly extension instead; a call over the step budget is refused up
 * front with requestTooLarge.
 */
final class BlobUploadMethod implements JmapMethodInterface
{
    public function __construct(
        private readonly BlobJoinService $joins,
        private readonly JmapBlobMaintenance $maintenance,
    ) {}

    public function name(): string
    {
        return 'Blob/upload';
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
        $create = $args['create'] ?? null;
        if (! is_array($create) || ($create !== [] && array_is_list($create))) {
            throw new JmapMethodException('invalidArguments', 'create must be a map of creation id to UploadObject.');
        }
        if (count($create) > JmapCapabilities::MAX_OBJECTS_IN_SET) {
            throw new JmapMethodException('requestTooLarge', 'create exceeds maxObjectsInSet.');
        }

        $result = $this->joins->upload($username, $create);
        $this->maintenance->maybeRun();

        return [
            'accountId' => $username,
            'created' => $result['created'] === [] ? null : $result['created'],
            'notCreated' => $result['notCreated'] === [] ? null : $result['notCreated'],
        ];
    }
}

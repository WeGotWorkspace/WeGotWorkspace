<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * FileNode/queryChanges is part of the advertised filenode capability, so
 * unknownMethod would be a compliance lie; cannotCalculateChanges is the
 * RFC-sanctioned answer and matches the always-false canCalculateChanges on
 * query responses — the same decision as the other domains.
 */
final class FileNodeQueryChangesMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'FileNode/queryChanges';
    }

    public function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        throw new JmapMethodException('cannotCalculateChanges', 'FileNode/queryChanges is not supported.');
    }
}

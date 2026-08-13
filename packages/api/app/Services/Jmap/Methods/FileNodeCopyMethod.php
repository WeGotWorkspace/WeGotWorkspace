<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * FileNode/copy (draft-ietf-jmap-filenode-14 §3.2.4) is the standard
 * Foo/copy: it copies records BETWEEN accounts (RFC 8620 §5.4 requires
 * fromAccountId ≠ accountId). This backend has exactly one account per
 * principal, so there is never a valid source account: same-account copies
 * are invalidArguments per the RFC, anything else is fromAccountNotFound.
 * Registered (not unknownMethod) because the capability advertises it —
 * documented deviation until cross-account support exists.
 */
final class FileNodeCopyMethod implements JmapMethodInterface
{
    public function name(): string
    {
        return 'FileNode/copy';
    }

    public function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return false;
    }

    public function handle(string $username, array $args): array
    {
        $fromAccountId = $args['fromAccountId'] ?? null;
        $accountId = $args['accountId'] ?? null;
        if (! is_string($fromAccountId) || ! is_string($accountId)) {
            throw new JmapMethodException('invalidArguments', 'fromAccountId and accountId are required.');
        }
        if ($fromAccountId === $accountId) {
            throw new JmapMethodException('invalidArguments', 'fromAccountId and accountId must differ (RFC 8620 §5.4).');
        }
        if ($accountId !== $username) {
            throw new JmapMethodException('accountNotFound');
        }

        throw new JmapMethodException('fromAccountNotFound');
    }
}

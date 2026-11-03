<?php

declare(strict_types=1);

namespace App\Services\Jmap\Guest;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\FileNodeQueryMethod;
use App\Services\Jmap\Methods\JmapMethodInterface;

/**
 * FileNode/query for a guest upload account (#1715): the shared root
 * (`isTopLevel: true`) or the direct children of one folder (`parentId`,
 * optionally with `name`), one folder at a time like `GET /files/children`.
 * Unfiltered, `ancestorId`, and `depth` queries walk the whole shared tree,
 * which an anonymous caller must not be able to start.
 */
final class GuestFileNodeQueryMethod implements JmapMethodInterface
{
    public function __construct(private readonly FileNodeQueryMethod $query) {}

    public function name(): string
    {
        return 'FileNode/query';
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
        $filter = $args['filter'] ?? null;
        $oneFolder = is_array($filter)
            && ! array_key_exists('operator', $filter)
            && ! array_key_exists('ancestorId', $filter)
            && (($filter['isTopLevel'] ?? null) === true || is_string($filter['parentId'] ?? null));
        if (! $oneFolder || ! in_array($args['depth'] ?? null, [null, 0], true)) {
            throw new JmapMethodException('invalidArguments', 'Guests query the shared folder or one folder\'s children.');
        }

        return $this->query->handle($username, $args);
    }
}

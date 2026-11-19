<?php

declare(strict_types=1);

namespace App\Services\Threads;

/**
 * The uri of a shared thread pool: `{subjectType}-threads`, one per owner
 * (a user or a Team) and subject type (#2173, docs/architecture/threads.md
 * rule 5). Tasks use `task-threads`.
 *
 * Every uri of that shape is reserved for `thread_pool`, so no calendar, task
 * list or notebook can take the name a pool will need later. `docs-threads`
 * keeps its own kind and is matched before this.
 */
final class ThreadPoolUris
{
    private const SUFFIX = '-threads';

    private const PATTERN = '/^[a-z][a-z0-9]{0,30}-threads$/';

    public static function forType(string $subjectType): string
    {
        return $subjectType.self::SUFFIX;
    }

    public static function isPoolUri(string $uri): bool
    {
        return preg_match(self::PATTERN, $uri) === 1;
    }
}

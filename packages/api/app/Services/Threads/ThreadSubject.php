<?php

declare(strict_types=1);

namespace App\Services\Threads;

/**
 * One subject a thread is about, as a subject type resolved it for one caller
 * (#2173). Nothing here names an app.
 *
 * - `id` is the id the routes use (for a task, its task id).
 * - `localKey` identifies the subject inside its scope (for a task, its UID).
 * - `scope` is where the audience is set, as stored (for a task, the list's
 *   calendarid). It never contains `:`.
 * - `scopeId` is the scope as this caller names it in the API (for a task,
 *   the caller's list id). A post's `scopeId` is compared with it.
 * - `poolOwner` is the principal uri whose pool holds the entries.
 */
final class ThreadSubject
{
    public function __construct(
        public readonly string $type,
        public readonly string $id,
        public readonly string $localKey,
        public readonly string $scope,
        public readonly string $scopeId,
        public readonly string $poolOwner,
        public readonly bool $canPost,
        public readonly mixed $context = null,
    ) {
        if ($scope === '' || str_contains($scope, ':')) {
            throw new \InvalidArgumentException('A thread scope must be non-empty and contain no ":".');
        }
    }

    /** The current key of the thread: its scope plus the subject inside it. */
    public function key(): string
    {
        return $this->scope.':'.$this->localKey;
    }

    /** True when $key is this subject under any scope. */
    public function isSameSubject(string $key): bool
    {
        $separator = strpos($key, ':');

        return $separator !== false && substr($key, $separator + 1) === $this->localKey;
    }
}

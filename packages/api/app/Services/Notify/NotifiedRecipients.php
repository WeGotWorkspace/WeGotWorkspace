<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Events\NotifyListener;
use App\Http\Middleware\ExposeNotifiedRecipients;

/**
 * Who this request's writes notified, per actor (#1662).
 *
 * {@see NotifyListener} records every principal whose inbox it
 * changed (row created, superseded or cleared). {@see ExposeNotifiedRecipients}
 * returns the names recorded for the request's own user in `X-Wgw-Notified`, so the
 * writer's tab can send exactly them a mesh `check-now`. The middleware empties
 * it when a request starts.
 */
final class NotifiedRecipients
{
    public const HEADER = 'X-Wgw-Notified';

    /** Bounds the header; the client caps what it sends as well. */
    public const MAX_HEADER_NAMES = 64;

    /** @var array<string, array<string, true>> actor => principal => true */
    private array $byActor = [];

    /** One request at a time: the middleware starts each request empty. */
    public function reset(): void
    {
        $this->byActor = [];
    }

    public function record(string $actor, string $principal): void
    {
        $actorKey = strtolower(trim($actor));
        $principalKey = strtolower(trim($principal));
        if ($actorKey === '' || $principalKey === '' || $actorKey === $principalKey) {
            return;
        }
        $this->byActor[$actorKey][$principalKey] = true;
    }

    /**
     * @return list<string> principals notified by `$actor`'s writes, sorted
     */
    public function notifiedBy(string $actor): array
    {
        $names = array_keys($this->byActor[strtolower(trim($actor))] ?? []);
        $names = array_values(array_filter(
            array_map('strval', $names),
            static fn (string $name): bool => self::headerSafe($name),
        ));
        sort($names);

        return array_slice($names, 0, self::MAX_HEADER_NAMES);
    }

    /** A comma-separated header value must not carry commas, spaces or control bytes. */
    private static function headerSafe(string $name): bool
    {
        return preg_match('/^[^\s,\x00-\x1f\x7f]+$/', $name) === 1;
    }
}

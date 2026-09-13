<?php

declare(strict_types=1);

namespace App\Events;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Illuminate\Support\Str;

/**
 * Suite mutation envelope. Dispatch-time PHP DTO only — not persisted.
 */
final readonly class WorkspaceEvent
{
    public const VISIBILITY_INTERNAL = 'internal';

    public const VISIBILITY_EXTERNAL_SAFE = 'external-safe';

    /**
     * @param  array<string, mixed>  $data
     */
    public function __construct(
        public string $eventId,
        public string $actor,
        public string $domain,
        public string $action,
        public string $target,
        public DateTimeImmutable $timestamp,
        public array $data,
        public string $visibility,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public static function make(
        string $actor,
        string $domain,
        string $action,
        string $target,
        array $data = [],
        string $visibility = self::VISIBILITY_INTERNAL,
        ?string $eventId = null,
        ?DateTimeInterface $timestamp = null,
    ): self {
        $ts = $timestamp instanceof DateTimeImmutable
            ? $timestamp
            : ($timestamp !== null
                ? DateTimeImmutable::createFromInterface($timestamp)
                : new DateTimeImmutable('now', new DateTimeZone('UTC')));

        return new self(
            eventId: $eventId ?? (string) Str::ulid(),
            actor: $actor,
            domain: $domain,
            action: $action,
            target: $target,
            timestamp: $ts->setTimezone(new DateTimeZone('UTC')),
            data: $data,
            visibility: $visibility,
        );
    }
}

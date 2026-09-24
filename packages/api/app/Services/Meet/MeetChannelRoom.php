<?php

declare(strict_types=1);

namespace App\Services\Meet;

/**
 * A meet room that resolved to a chat channel collection (chunk H).
 */
final readonly class MeetChannelRoom
{
    public function __construct(
        public int $calendarId,
        public string $channelUri,
        public bool $isDm,
    ) {}
}

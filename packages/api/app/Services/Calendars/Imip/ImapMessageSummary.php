<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * What one FETCH tells about a message before any body is read.
 */
final readonly class ImapMessageSummary
{
    public function __construct(
        public int $uid,
        public int $size,
        public MailHeaders $headers,
        public ?ImapCalendarPart $calendarPart,
    ) {}
}

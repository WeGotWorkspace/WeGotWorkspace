<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * The calendar body part found in a message's BODYSTRUCTURE.
 */
final readonly class ImapCalendarPart
{
    public function __construct(
        public string $section,
        public string $encoding,
        public string $charset,
        public string $method,
        public int $size,
    ) {}
}

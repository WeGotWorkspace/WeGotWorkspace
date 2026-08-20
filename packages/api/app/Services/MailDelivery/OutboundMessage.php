<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

final class OutboundMessage
{
    /**
     * @param  list<string>  $to
     */
    public function __construct(
        public string $from,
        public array $to,
        public string $subject,
        public string $textBody,
        public ?string $htmlBody = null,
        public ?string $calendarMethod = null,
        public ?string $calendarIcs = null,
    ) {}
}

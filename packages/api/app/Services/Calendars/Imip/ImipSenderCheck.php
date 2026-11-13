<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * Outcome of {@see ImipSenderAuthentication}: the verified From address, or
 * the reason code it was not verified.
 */
final readonly class ImipSenderCheck
{
    private function __construct(
        public ?MailAddress $sender,
        public string $reason,
    ) {}

    public static function verified(MailAddress $sender): self
    {
        return new self($sender, '');
    }

    public static function refused(string $reason): self
    {
        return new self(null, $reason);
    }

    public function ok(): bool
    {
        return $this->sender !== null;
    }
}

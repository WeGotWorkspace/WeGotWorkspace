<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

final class ResolvedTransport
{
    /**
     * @param  'smtp'|'php'|'sendmail'|''  $name
     * @param  array{host: string, port: int, security: string, smtpAuth: bool}|null  $smtp
     */
    public function __construct(
        public string $name,
        public ?string $blockStatus,
        public ?array $smtp,
    ) {}

    public function canAttempt(): bool
    {
        return $this->name !== '' && $this->blockStatus === null;
    }
}

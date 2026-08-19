<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

final class MailDeliveryConfig
{
    public const TRANSPORT_AUTO = 'auto';

    public const TRANSPORT_SMTP = 'smtp';

    public const TRANSPORT_PHP = 'php';

    public const TRANSPORT_SENDMAIL = 'sendmail';

    /**
     * @param  self::TRANSPORT_AUTO|self::TRANSPORT_SMTP|self::TRANSPORT_PHP|self::TRANSPORT_SENDMAIL  $transport
     */
    public function __construct(
        public string $from,
        public string $transport,
        public string $smtpHost,
        public int $smtpPort,
        public string $smtpSecurity,
        public string $smtpUsername,
        public string $smtpPassword,
        public bool $smtpPasswordSet,
    ) {}

    /**
     * @return array{from: string, transport: string, smtpHost: string, smtpPort: int, smtpSecurity: string, smtpUsername: string, smtpPasswordSet: bool}
     */
    public function publicArray(): array
    {
        return [
            'from' => $this->from,
            'transport' => $this->transport,
            'smtpHost' => $this->smtpHost,
            'smtpPort' => $this->smtpPort,
            'smtpSecurity' => $this->smtpSecurity,
            'smtpUsername' => $this->smtpUsername,
            'smtpPasswordSet' => $this->smtpPasswordSet,
        ];
    }
}

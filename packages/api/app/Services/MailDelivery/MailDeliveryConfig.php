<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

final class MailDeliveryConfig
{
    public const TRANSPORT_AUTO = 'auto';

    public const TRANSPORT_SMTP = 'smtp';

    public const TRANSPORT_PHP = 'php';

    public const TRANSPORT_SENDMAIL = 'sendmail';

    /** Installer-style placeholder when Admin has not saved a valid From. */
    public const PLACEHOLDER_FROM = 'noreply@localhost';

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

    public static function isUsableFrom(string $from): bool
    {
        $from = trim($from);
        if ($from === '') {
            return false;
        }
        if (filter_var($from, FILTER_VALIDATE_EMAIL) !== false) {
            return true;
        }

        // PHP FILTER_VALIDATE_EMAIL rejects @localhost (no public TLD).
        return (bool) preg_match('/^[^@\s]+@localhost$/i', $from);
    }

    public function fromConfigured(): bool
    {
        return self::isUsableFrom($this->from);
    }

    public function effectiveFrom(): string
    {
        return $this->fromConfigured() ? trim($this->from) : self::PLACEHOLDER_FROM;
    }

    public function resolveFrom(string $messageFrom): string
    {
        return self::isUsableFrom($messageFrom) ? trim($messageFrom) : $this->effectiveFrom();
    }

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

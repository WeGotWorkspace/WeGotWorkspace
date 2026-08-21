<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use App\Services\Mail\MailSmtpTransportConfig;

final class MailDeliveryTransportResolver
{
    /** @var (callable(): bool)|null */
    private $phpMailProbe;

    /** @var (callable(): bool)|null */
    private $sendmailProbe;

    public function __construct(?callable $phpMailProbe = null, ?callable $sendmailProbe = null)
    {
        $this->phpMailProbe = $phpMailProbe;
        $this->sendmailProbe = $sendmailProbe;
    }

    /**
     * @return array{host: string, port: int, security: string, smtpAuth: bool}
     */
    public function normalizeSmtp(MailDeliveryConfig $config): array
    {
        return MailSmtpTransportConfig::normalize([
            'host' => $config->smtpHost,
            'port' => $config->smtpPort,
            'security' => $config->smtpSecurity,
        ]);
    }

    public function isSmtpEligible(MailDeliveryConfig $config): bool
    {
        $host = trim($config->smtpHost);
        if ($host === '') {
            return false;
        }

        $normalized = $this->normalizeSmtp($config);

        return trim($config->smtpUsername) !== '' || $normalized['smtpAuth'] === false;
    }

    public function resolve(MailDeliveryConfig $config): ResolvedTransport
    {
        $normalized = $this->normalizeSmtp($config);
        $mode = $config->transport;

        if ($mode === MailDeliveryConfig::TRANSPORT_SMTP) {
            if (trim($config->smtpHost) === '') {
                return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SMTP, DeliveryResult::UNAVAILABLE, $normalized);
            }
            if ($normalized['smtpAuth'] && trim($config->smtpUsername) === '') {
                return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SMTP, DeliveryResult::SMTP_AUTH_REQUIRED, $normalized);
            }

            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SMTP, null, $normalized);
        }

        if ($mode === MailDeliveryConfig::TRANSPORT_PHP) {
            $block = $this->phpMailAvailable() ? null : DeliveryResult::UNAVAILABLE;

            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_PHP, $block, null);
        }

        if ($mode === MailDeliveryConfig::TRANSPORT_SENDMAIL) {
            $block = $this->sendmailAvailable() ? null : DeliveryResult::UNAVAILABLE;

            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SENDMAIL, $block, null);
        }

        if ($this->isSmtpEligible($config)) {
            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SMTP, null, $normalized);
        }
        if ($this->phpMailAvailable()) {
            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_PHP, null, null);
        }
        if ($this->sendmailAvailable()) {
            return new ResolvedTransport(MailDeliveryConfig::TRANSPORT_SENDMAIL, null, null);
        }

        return new ResolvedTransport('', DeliveryResult::UNAVAILABLE, null);
    }

    /**
     * @return array{canSubmit: bool, selectedTransport: string|null, probes: array{fromConfigured: bool, smtpEligible: bool, smtpAuthRequired: bool, phpMailAvailable: bool, sendmailAvailable: bool}}
     */
    public function capability(MailDeliveryConfig $config): array
    {
        $normalized = $this->normalizeSmtp($config);
        $resolved = $this->resolve($config);
        $fromConfigured = $config->fromConfigured();
        $selected = $resolved->name !== '' ? $resolved->name : null;

        return [
            'canSubmit' => $resolved->canAttempt(),
            'selectedTransport' => $selected,
            'probes' => [
                'fromConfigured' => $fromConfigured,
                'smtpEligible' => $this->isSmtpEligible($config),
                'smtpAuthRequired' => $normalized['smtpAuth'],
                'phpMailAvailable' => $this->phpMailAvailable(),
                'sendmailAvailable' => $this->sendmailAvailable(),
            ],
        ];
    }

    public function phpMailAvailable(): bool
    {
        if ($this->phpMailProbe !== null) {
            return (bool) ($this->phpMailProbe)();
        }

        return function_exists('mail');
    }

    public function sendmailAvailable(): bool
    {
        if ($this->sendmailProbe !== null) {
            return (bool) ($this->sendmailProbe)();
        }

        $path = trim((string) ini_get('sendmail_path'));
        if ($path === '') {
            $path = '/usr/sbin/sendmail';
        }
        $binary = explode(' ', $path, 2)[0];

        return $binary !== '' && is_executable($binary);
    }
}

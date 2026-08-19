<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use Illuminate\Support\Facades\Mail;
use Symfony\Component\Mailer\Transport\SendmailTransport;

final class MailDeliveryMailerFactory
{
    public const MAILER_NAME = 'wgw';

    public const TIMEOUT_SECONDS = 10;

    private static bool $sendmailExtended = false;

    public function __construct(private MailDeliveryTransportResolver $resolver) {}

    /**
     * @return array<string, mixed>
     */
    public function mailerConfig(string $transport, MailDeliveryConfig $config): array
    {
        if ($transport === MailDeliveryConfig::TRANSPORT_SMTP) {
            $normalized = $config->smtpHost === '' && $config->smtpPort === 0
                ? [
                    'host' => '',
                    'port' => 587,
                    'security' => 'starttls',
                    'smtpAuth' => true,
                ]
                : $this->resolver->normalizeSmtp($config);
            $encryption = match ($normalized['security']) {
                'ssl' => 'ssl',
                'starttls' => 'tls',
                default => null,
            };

            return [
                'transport' => 'smtp',
                'host' => $normalized['host'],
                'port' => $normalized['port'],
                'encryption' => $encryption,
                'username' => $normalized['smtpAuth'] ? $config->smtpUsername : null,
                'password' => $normalized['smtpAuth'] ? $config->smtpPassword : null,
                'timeout' => self::TIMEOUT_SECONDS,
            ];
        }

        if ($transport === MailDeliveryConfig::TRANSPORT_SENDMAIL) {
            $path = trim((string) ini_get('sendmail_path'));

            return [
                'transport' => 'wgw_sendmail',
                'path' => $path !== '' ? $path : '/usr/sbin/sendmail -bs -i',
                'timeout' => self::TIMEOUT_SECONDS,
            ];
        }

        return [
            'transport' => 'mail',
        ];
    }

    public function register(string $transport, MailDeliveryConfig $config): void
    {
        $this->ensureSendmailTransport();
        config(['mail.mailers.'.self::MAILER_NAME => $this->mailerConfig($transport, $config)]);
        Mail::purge(self::MAILER_NAME);
    }

    private function ensureSendmailTransport(): void
    {
        if (self::$sendmailExtended) {
            return;
        }
        Mail::extend('wgw_sendmail', function (array $config): SendmailTransport {
            $command = trim((string) ($config['path'] ?? ''));
            if ($command === '') {
                $command = trim((string) ini_get('sendmail_path'));
            }
            if ($command === '') {
                $command = '/usr/sbin/sendmail -bs -i';
            }

            return new SendmailTransport($command, (int) ($config['timeout'] ?? self::TIMEOUT_SECONDS));
        });
        self::$sendmailExtended = true;
    }
}

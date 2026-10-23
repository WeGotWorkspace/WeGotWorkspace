<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

/**
 * Normalizes the platform SMTP endpoint: port, security and whether to authenticate.
 */
final class MailDeliverySmtpTransport
{
    /**
     * @param  array{host?: string, port?: int|string, security?: string}  $smtp
     * @return array{host: string, port: int, security: string, smtpAuth: bool}
     */
    public static function normalize(array $smtp): array
    {
        $host = trim((string) ($smtp['host'] ?? ''));
        $port = (int) ($smtp['port'] ?? 587);
        if ($port < 1 || $port > 65535) {
            $port = 587;
        }

        $security = strtolower(trim((string) ($smtp['security'] ?? 'ssl')));
        if (! in_array($security, ['ssl', 'starttls', 'none'], true)) {
            $security = 'ssl';
        }

        // Common misconfigurations (Admin default 465/ssl vs installer 587/starttls).
        if ($port === 587 && $security === 'ssl') {
            $security = 'starttls';
        } elseif ($port === 465 && $security === 'starttls') {
            $security = 'ssl';
        } elseif ($port === 25 && $security === 'ssl') {
            $security = 'none';
        }

        $overrideHost = getenv('WGW_MAIL_SMTP_HOST_OVERRIDE');
        if (is_string($overrideHost) && trim($overrideHost) !== '') {
            $host = trim($overrideHost);
        }

        $smtpAuth = $security !== 'none' || ! self::isLocalHost($host);

        return [
            'host' => $host,
            'port' => $port,
            'security' => $security,
            'smtpAuth' => $smtpAuth,
        ];
    }

    /**
     * @param  array{host: string, port: int, security: string, smtpAuth: bool}  $transport
     */
    public static function describe(array $transport): string
    {
        return sprintf(
            '%s:%d (%s)',
            $transport['host'] !== '' ? $transport['host'] : '?',
            $transport['port'],
            $transport['security']
        );
    }

    public static function canReachTcp(string $host, int $port, float $timeoutSec = 5.0): bool
    {
        if ($host === '' || $port < 1) {
            return false;
        }

        $errno = 0;
        $errstr = '';
        $target = str_contains($host, ':') && ! str_starts_with($host, '[')
            ? '['.$host.']'
            : $host;
        $fp = @fsockopen($target, $port, $errno, $errstr, $timeoutSec);
        if (is_resource($fp)) {
            fclose($fp);

            return true;
        }

        return false;
    }

    private static function isLocalHost(string $host): bool
    {
        $h = strtolower(trim($host));

        return in_array($h, ['localhost', '127.0.0.1', '::1'], true);
    }
}

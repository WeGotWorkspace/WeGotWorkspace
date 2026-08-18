<?php

declare(strict_types=1);

namespace App\Services\MailDelivery;

use App\Exceptions\ApiHttpException;
use App\Models\AppSetting;
use App\Services\Settings\SettingKeys;

final class MailDeliverySettingsStore
{
    public function __construct(private MailDeliverySecretService $secrets) {}

    public function load(): MailDeliveryConfig
    {
        $encrypted = trim((string) AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, ''));
        $password = $encrypted !== '' ? $this->secrets->decrypt($encrypted) : '';

        return new MailDeliveryConfig(
            from: trim((string) AppSetting::getValue(SettingKeys::MAIL_DELIVERY_FROM, '')),
            transport: $this->normalizeTransport(AppSetting::getValue(SettingKeys::MAIL_DELIVERY_TRANSPORT, MailDeliveryConfig::TRANSPORT_AUTO)),
            smtpHost: trim((string) AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_HOST, '')),
            smtpPort: $this->normalizePort(AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_PORT, 587)),
            smtpSecurity: $this->normalizeSecurity(AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_SECURITY, 'starttls')),
            smtpUsername: trim((string) AppSetting::getValue(SettingKeys::MAIL_DELIVERY_SMTP_USERNAME, '')),
            smtpPassword: $password,
            smtpPasswordSet: $password !== '',
        );
    }

    /**
     * @param  array<string, mixed>  $values
     */
    public function persistAdminSave(array $values, bool $clearSmtpPassword): void
    {
        $incomingPassword = '';
        $passwordPresent = array_key_exists(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, $values);
        if ($passwordPresent) {
            $incomingPassword = is_string($values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD])
                ? $values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD]
                : '';
        }
        $hasNewPassword = $passwordPresent && $incomingPassword !== '';
        if ($hasNewPassword && $clearSmtpPassword) {
            throw new ApiHttpException(400, 'Cannot set a new SMTP password and clear it in the same request.', 'bad_request');
        }

        if ($clearSmtpPassword) {
            AppSetting::setValue(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, '');
        } elseif ($hasNewPassword) {
            AppSetting::setValue(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, $this->secrets->encrypt($incomingPassword));
        }
    }

    /**
     * @param  array{accepted: bool, status: string, transport: string, at: string, message: string|null}  $result
     */
    public function storeLastTestSend(array $result): void
    {
        AppSetting::setValue(SettingKeys::MAIL_DELIVERY_LAST_TEST_SEND, $result);
    }

    /**
     * @return array{accepted: bool, status: string, transport: string, at: string, message: string|null}|null
     */
    public function lastTestSend(): ?array
    {
        $raw = AppSetting::getValue(SettingKeys::MAIL_DELIVERY_LAST_TEST_SEND, null);
        if (! is_array($raw)) {
            return null;
        }
        $status = (string) ($raw['status'] ?? '');
        if ($status === '') {
            return null;
        }

        return [
            'accepted' => (bool) ($raw['accepted'] ?? false),
            'status' => $status,
            'transport' => (string) ($raw['transport'] ?? ''),
            'at' => (string) ($raw['at'] ?? ''),
            'message' => isset($raw['message']) && is_string($raw['message']) ? $raw['message'] : null,
        ];
    }

    private function normalizeTransport(mixed $value): string
    {
        $transport = strtolower(trim((string) $value));

        return in_array($transport, [
            MailDeliveryConfig::TRANSPORT_AUTO,
            MailDeliveryConfig::TRANSPORT_SMTP,
            MailDeliveryConfig::TRANSPORT_PHP,
            MailDeliveryConfig::TRANSPORT_SENDMAIL,
        ], true) ? $transport : MailDeliveryConfig::TRANSPORT_AUTO;
    }

    private function normalizePort(mixed $value): int
    {
        $port = (int) $value;

        return ($port < 1 || $port > 65535) ? 587 : $port;
    }

    private function normalizeSecurity(mixed $value): string
    {
        $security = strtolower(trim((string) $value));

        return in_array($security, ['ssl', 'starttls', 'none'], true) ? $security : 'starttls';
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\AppSetting;
use App\Services\MailDelivery\MailDeliverySettingsStore;
use App\Services\Settings\SettingKeys;
use App\Support\TimezoneNormalizer;

final class AdminSettingsService
{
    public function __construct(private MailDeliverySettingsStore $mailDelivery) {}

    /**
     * @param  array<string, mixed>  $values
     * @return array{ok: true, saved: list<string>}
     */
    public function save(array $values, bool $clearSmtpPassword = false): array
    {
        $passwordInPayload = array_key_exists(SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD, $values);
        $this->mailDelivery->persistAdminSave($values, $clearSmtpPassword);
        unset($values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD], $values[SettingKeys::MAIL_DELIVERY_LAST_TEST_SEND]);

        $allowed = array_flip(SettingKeys::all());
        $saved = [];
        if ($clearSmtpPassword || ($passwordInPayload && is_string($values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD] ?? null) && $values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD] !== '')) {
            // Password key is handled separately so plaintext never reaches AppSetting.
        }
        foreach ($values as $key => $value) {
            if (! is_string($key) || ! isset($allowed[$key])) {
                continue;
            }
            if ($key === SettingKeys::TIMEZONE) {
                $value = TimezoneNormalizer::normalize($value);
            }
            if ($key === SettingKeys::RTC_STUN_URL || $key === SettingKeys::RTC_TURN_URL) {
                $value = $this->normalizeRtcUrls($value);
            }
            AppSetting::setValue($key, $value);
            $saved[] = $key;
        }

        return ['ok' => true, 'saved' => $saved];
    }

    private function normalizeRtcUrls(mixed $value): string
    {
        if (! is_string($value)) {
            return '';
        }
        $parts = array_filter(
            array_map(
                static fn (string $piece): string => trim($piece),
                preg_split('/[\r\n,]+/', $value) ?: []
            ),
            static fn (string $piece): bool => $piece !== ''
        );

        return implode(', ', $parts);
    }
}

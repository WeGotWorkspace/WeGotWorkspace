<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\AppSetting;
use App\Services\MailDelivery\MailDeliverySettingsStore;
use App\Services\Mcp\McpAuditLogger;
use App\Services\Mcp\McpEnabled;
use App\Services\Rtc\MeetVideoProfile;
use App\Services\Rtc\RtcSettingsService;
use App\Services\Settings\SettingKeys;
use App\Support\TimezoneNormalizer;

final class AdminSettingsService
{
    public function __construct(
        private MailDeliverySettingsStore $mailDelivery,
        private McpEnabled $mcp,
        private McpAuditLogger $mcpAudit,
        private RtcSettingsService $rtcSettings,
    ) {}

    /**
     * @param  array<string, mixed>  $values
     * @return array{ok: true, saved: list<string>}
     */
    public function save(array $values, bool $clearSmtpPassword = false, bool $clearTurnSecret = false): array
    {
        $this->mailDelivery->persistAdminSave($values, $clearSmtpPassword);
        unset($values[SettingKeys::MAIL_DELIVERY_SMTP_PASSWORD], $values[SettingKeys::MAIL_DELIVERY_LAST_TEST_SEND]);
        $values = $this->resolveTurnSecret($values, $clearTurnSecret);

        $wasMcpOn = $this->mcp->isOn();
        $allowed = array_flip(SettingKeys::all());
        $saved = [];
        foreach ($values as $key => $value) {
            if (! isset($allowed[$key])) {
                continue;
            }
            if ($key === SettingKeys::TIMEZONE) {
                $value = TimezoneNormalizer::normalize($value);
            }
            if ($key === SettingKeys::RTC_STUN_URL || $key === SettingKeys::RTC_TURN_URL) {
                $value = $this->normalizeRtcUrls($value);
            }
            if ($key === SettingKeys::MEET_MAX_VIDEO_PROFILE) {
                $value = MeetVideoProfile::normalize($value, RtcSettingsService::DEFAULT_MAX_VIDEO_PROFILE);
            }
            if ($key === SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY) {
                $value = MeetVideoProfile::normalize($value, RtcSettingsService::DEFAULT_MAX_VIDEO_PROFILE_RELAY);
            }
            if ($key === SettingKeys::RTC_DEBUG_LOGGING || $key === SettingKeys::RTC_FORCE_RELAY) {
                $value = filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true;
            }
            AppSetting::setValue($key, $value);
            $saved[] = $key;
        }

        if (in_array(SettingKeys::MCP_ENABLED, $saved, true) && $wasMcpOn && ! $this->mcp->isOn()) {
            $this->mcp->revokeAllGrants();
            $this->mcpAudit->log(McpAuditLogger::KILL_SWITCH, 'ok', access: 'write', target: ['enabled' => false]);
        } elseif (in_array(SettingKeys::MCP_ENABLED, $saved, true) && ! $wasMcpOn && $this->mcp->isOn()) {
            $this->mcpAudit->log(McpAuditLogger::KILL_SWITCH, 'ok', access: 'write', target: ['enabled' => true]);
        }

        return ['ok' => true, 'saved' => $saved];
    }

    /**
     * The admin form never receives the relay secret, so it cannot send it
     * back: an empty value means "leave it alone" and clearing needs the
     * explicit flag. Saving a secret also drops the dead static credentials,
     * which is what the warning asks the admin to resolve.
     *
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function resolveTurnSecret(array $values, bool $clearTurnSecret): array
    {
        if ($clearTurnSecret) {
            $values[SettingKeys::RTC_TURN_SECRET] = '';

            return $values;
        }

        if (! array_key_exists(SettingKeys::RTC_TURN_SECRET, $values)) {
            return $values;
        }

        $secret = is_string($values[SettingKeys::RTC_TURN_SECRET])
            ? trim($values[SettingKeys::RTC_TURN_SECRET])
            : '';
        if ($secret === '') {
            unset($values[SettingKeys::RTC_TURN_SECRET]);

            return $values;
        }

        $values[SettingKeys::RTC_TURN_SECRET] = $this->rtcSettings->sealTurnSecret($secret);
        $this->rtcSettings->forgetLegacyStaticCredentials();

        return $values;
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

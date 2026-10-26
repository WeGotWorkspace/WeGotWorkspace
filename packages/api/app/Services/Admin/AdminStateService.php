<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\AppSetting;
use App\Services\Calendars\CalendarImipService;
use App\Services\Installer\DataDirCandidateResolver;
use App\Services\MailDelivery\MailDeliveryService;
use App\Services\Mcp\McpPublicOrigin;
use App\Services\Rtc\MeetVideoProfile;
use App\Services\Rtc\RtcSettingsService;
use App\Services\Settings\GroupDirectoryService;
use App\Services\Settings\SettingKeys;
use App\Services\Update\UpdateStateService;
use App\Support\ApiUrlBuilder;
use App\Support\PublicAppUrl;
use App\Support\WgwSettings;

final class AdminStateService
{
    public function __construct(
        private AdminUserDirectoryService $users,
        private GroupDirectoryService $groups,
        private UpdateStateService $updates,
        private MailDeliveryService $mailDelivery,
        private ApiUrlBuilder $urls,
        private RtcSettingsService $rtcSettings,
        private DataDirCandidateResolver $dataDirs,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function snapshot(string $adminUsername): array
    {
        $cfg = WgwSettings::normalized();

        return [
            'users' => $this->users->listSummaries(),
            'groups' => $this->groups->listGroupSummaries(),
            // Older installs stored one SMTP endpoint here; Email delivery prefills from it.
            'mail' => [
                'smtpHost' => (string) ($cfg[SettingKeys::MAIL_SMTP_HOST] ?? ''),
                'smtpPort' => (int) ($cfg[SettingKeys::MAIL_SMTP_PORT] ?? 587),
                'smtpSecurity' => (string) ($cfg[SettingKeys::MAIL_SMTP_SECURITY] ?? 'starttls'),
            ],
            'mailDelivery' => $this->mailDelivery->adminState(),
            'rtc' => $this->rtcSettings(),
            'apps' => [
                'calendars' => (bool) ($cfg[SettingKeys::CALENDAR_ENABLED] ?? true),
                'contacts' => (bool) ($cfg[SettingKeys::CONTACTS_ENABLED] ?? true),
                'tasks' => (bool) ($cfg[SettingKeys::TASKS_ENABLED] ?? true),
                'imipExternalEnabled' => $this->imipExternalEnabled(),
                'imipHourlyLimit' => $this->imipHourlyLimit(),
                'imipDailyLimit' => $this->imipDailyLimit(),
            ],
            'webdav' => [
                'sabreUi' => (bool) ($cfg[SettingKeys::BROWSER_PLUGIN] ?? false),
                'timezone' => (string) ($cfg[SettingKeys::TIMEZONE] ?? 'UTC'),
                'baseUri' => (string) ($cfg[SettingKeys::BASE_URI] ?? '/'),
                'authRealm' => (string) ($cfg[SettingKeys::AUTH_REALM] ?? 'SabreDAV'),
            ],
            'updates' => $this->updates->snapshot(),
            'mcp' => [
                'enabled' => (bool) AppSetting::getValue(SettingKeys::MCP_ENABLED, false),
                'endpointUrl' => McpPublicOrigin::configuredEndpointUrl(),
            ],
            'currentUser' => $adminUsername,
            'logoutUrl' => $this->urls->logout(),
            'securityWarnings' => $this->securityWarnings(),
        ];
    }

    /**
     * Each warning carries a stable `code`; the admin page acts on the code, never on the message.
     *
     * @return list<array{code: string, message: string}>
     */
    private function securityWarnings(): array
    {
        $warnings = [];
        if (config('app.debug') === true) {
            $warnings[] = $this->warning('app_debug_on', 'APP_DEBUG is on. Error responses can include exception details.');
        }
        if (! app()->environment('production')) {
            $warnings[] = $this->warning('app_env_not_production', 'APP_ENV is '.app()->environment().', not production.');
        }
        if (PublicAppUrl::isLoopback()) {
            $warnings[] = $this->warning('app_url_local', 'APP_URL is a local address ('.rtrim((string) config('app.url'), '/').'). Host checks and password-reset mail stay off until it is the site\'s public address: reset links must point there.');
        } elseif (! PublicAppUrl::isConfigured()) {
            $warnings[] = $this->warning('app_url_unset', 'APP_URL is not set; the Host header is not validated and password-reset mail is disabled.');
        }
        if ($this->dataDirs->configuredDirectoryIsPublished()) {
            $warnings[] = $this->warning('data_dir_published', 'The data directory is inside the published website. Move it outside the web root so the database and signing key are not downloadable.');
        }

        return $warnings;
    }

    /**
     * @return array{code: string, message: string}
     */
    private function warning(string $code, string $message): array
    {
        return ['code' => $code, 'message' => $message];
    }

    private function imipExternalEnabled(): bool
    {
        return filter_var(
            AppSetting::getValue(SettingKeys::IMIP_EXTERNAL_ENABLED, true),
            FILTER_VALIDATE_BOOLEAN,
        );
    }

    private function imipDailyLimit(): int
    {
        return CalendarImipService::normalizeDailyLimit(
            AppSetting::getValue(SettingKeys::IMIP_DAILY_LIMIT, CalendarImipService::DAILY_LIMIT_DEFAULT),
        );
    }

    private function imipHourlyLimit(): int
    {
        return CalendarImipService::normalizeHourlyLimit(
            AppSetting::getValue(SettingKeys::IMIP_HOURLY_LIMIT, CalendarImipService::HOURLY_LIMIT_DEFAULT),
            $this->imipDailyLimit(),
        );
    }

    /**
     * The relay secret is write-only: admin only ever learns whether one is
     * set. Leftover static credentials from an older install no longer relay
     * anything, so they are reported as a warning instead.
     *
     * @return array{stunUrls: string, turnUrls: string, turnSecretSet: bool, turnStaticCredentialsPresent: bool, maxVideoProfile: string, maxVideoProfileRelay: string, debugLogging: bool, forceRelay: bool}
     */
    private function rtcSettings(): array
    {
        $normalizeUrls = static function (mixed $value): string {
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
        };

        return [
            'stunUrls' => $normalizeUrls(AppSetting::getValue(SettingKeys::RTC_STUN_URL, '')),
            'turnUrls' => $normalizeUrls(AppSetting::getValue(SettingKeys::RTC_TURN_URL, '')),
            'turnSecretSet' => $this->rtcSettings->turnSecret() !== '',
            'turnStaticCredentialsPresent' => $this->rtcSettings->legacyStaticCredentialsPresent(),
            'maxVideoProfile' => $this->rtcSettings->maxVideoProfile(),
            // The stored relay value, not the clamped one: admin edits what it
            // set, and the clamp belongs to what the client is served.
            'maxVideoProfileRelay' => MeetVideoProfile::normalize(
                AppSetting::getValue(SettingKeys::MEET_MAX_VIDEO_PROFILE_RELAY, ''),
                RtcSettingsService::DEFAULT_MAX_VIDEO_PROFILE_RELAY
            ),
            'debugLogging' => $this->rtcSettings->storedFlag(SettingKeys::RTC_DEBUG_LOGGING),
            // The stored switch, not the served one: admin edits what it set.
            'forceRelay' => $this->rtcSettings->storedFlag(SettingKeys::RTC_FORCE_RELAY),
        ];
    }
}

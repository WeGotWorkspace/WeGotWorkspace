<?php

declare(strict_types=1);

namespace App\Services\Admin;

use App\Models\AppSetting;
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
            'mail' => [
                'imapHost' => (string) ($cfg[SettingKeys::MAIL_IMAP_HOST] ?? ''),
                'imapPort' => (int) ($cfg[SettingKeys::MAIL_IMAP_PORT] ?? 993),
                'imapSecurity' => (string) ($cfg[SettingKeys::MAIL_IMAP_SECURITY] ?? 'ssl'),
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
     * @return list<string>
     */
    private function securityWarnings(): array
    {
        $warnings = [];
        if (config('app.debug') === true) {
            $warnings[] = 'APP_DEBUG is on. Error responses can include exception details.';
        }
        if (! app()->environment('production')) {
            $warnings[] = 'APP_ENV is '.app()->environment().', not production.';
        }
        if (! PublicAppUrl::isConfigured()) {
            $warnings[] = 'APP_URL is not set; the Host header is not validated and password-reset mail is disabled.';
        }

        return $warnings;
    }

    /**
     * The relay secret is write-only: admin only ever learns whether one is
     * set. Leftover static credentials from an older install no longer relay
     * anything, so they are reported as a warning instead.
     *
     * @return array{stunUrls: string, turnUrls: string, turnSecretSet: bool, turnStaticCredentialsPresent: bool, maxVideoProfile: string, maxVideoProfileRelay: string}
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
        ];
    }
}

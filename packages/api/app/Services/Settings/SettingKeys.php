<?php

declare(strict_types=1);

namespace App\Services\Settings;

final class SettingKeys
{
    public const TIMEZONE = 'timezone';

    public const BASE_URI = 'base_uri';

    public const AUTH_REALM = 'auth_realm';

    public const BROWSER_PLUGIN = 'browser_plugin';

    public const FILES_ENABLED = 'files_enabled';

    public const CALENDAR_ENABLED = 'calendar_enabled';

    public const CONTACTS_ENABLED = 'contacts_enabled';

    public const TASKS_ENABLED = 'tasks_enabled';

    public const MAIL_ENABLED = 'mail_enabled';

    public const RTC_STUN_URL = 'rtc_stun_url';

    public const RTC_TURN_URL = 'rtc_turn_url';

    public const RTC_TURN_USERNAME = 'rtc_turn_username';

    public const RTC_TURN_CREDENTIAL = 'rtc_turn_credential';

    public const MAIL_IMAP_HOST = 'mail_imap_host';

    public const MAIL_IMAP_PORT = 'mail_imap_port';

    public const MAIL_IMAP_SECURITY = 'mail_imap_security';

    public const MAIL_SMTP_HOST = 'mail_smtp_host';

    public const MAIL_SMTP_PORT = 'mail_smtp_port';

    public const MAIL_SMTP_SECURITY = 'mail_smtp_security';

    public const MAIL_DELIVERY_FROM = 'mail_delivery_from';

    public const MAIL_DELIVERY_TRANSPORT = 'mail_delivery_transport';

    public const MAIL_DELIVERY_SMTP_HOST = 'mail_delivery_smtp_host';

    public const MAIL_DELIVERY_SMTP_PORT = 'mail_delivery_smtp_port';

    public const MAIL_DELIVERY_SMTP_SECURITY = 'mail_delivery_smtp_security';

    public const MAIL_DELIVERY_SMTP_USERNAME = 'mail_delivery_smtp_username';

    public const MAIL_DELIVERY_SMTP_PASSWORD = 'mail_delivery_smtp_password';

    public const MAIL_DELIVERY_LAST_TEST_SEND = 'mail_delivery_last_test_send';

    /**
     * @return list<string>
     */
    public static function all(): array
    {
        return [
            self::TIMEZONE,
            self::BASE_URI,
            self::AUTH_REALM,
            self::BROWSER_PLUGIN,
            self::FILES_ENABLED,
            self::CALENDAR_ENABLED,
            self::CONTACTS_ENABLED,
            self::TASKS_ENABLED,
            self::MAIL_ENABLED,
            self::RTC_STUN_URL,
            self::RTC_TURN_URL,
            self::RTC_TURN_USERNAME,
            self::RTC_TURN_CREDENTIAL,
            self::MAIL_IMAP_HOST,
            self::MAIL_IMAP_PORT,
            self::MAIL_IMAP_SECURITY,
            self::MAIL_SMTP_HOST,
            self::MAIL_SMTP_PORT,
            self::MAIL_SMTP_SECURITY,
            self::MAIL_DELIVERY_FROM,
            self::MAIL_DELIVERY_TRANSPORT,
            self::MAIL_DELIVERY_SMTP_HOST,
            self::MAIL_DELIVERY_SMTP_PORT,
            self::MAIL_DELIVERY_SMTP_SECURITY,
            self::MAIL_DELIVERY_SMTP_USERNAME,
        ];
    }
}

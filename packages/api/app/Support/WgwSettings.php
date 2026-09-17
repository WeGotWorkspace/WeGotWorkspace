<?php

declare(strict_types=1);

namespace App\Support;

use App\Models\AppSetting;

final class WgwSettings
{
    public const MAIL_IMAP_HOST = 'mail_imap_host';

    public const MAIL_IMAP_PORT = 'mail_imap_port';

    public const MAIL_IMAP_SECURITY = 'mail_imap_security';

    public const MAIL_SMTP_HOST = 'mail_smtp_host';

    public const MAIL_SMTP_PORT = 'mail_smtp_port';

    public const MAIL_SMTP_SECURITY = 'mail_smtp_security';

    public const BASE_URI = 'base_uri';

    public const FILES_ENABLED = 'files_enabled';

    public const CALENDAR_ENABLED = 'calendar_enabled';

    public const CONTACTS_ENABLED = 'contacts_enabled';

    public const TASKS_ENABLED = 'tasks_enabled';

    public const NOTES_ENABLED = 'notes_enabled';

    public const AUTH_REALM = 'auth_realm';

    public const BROWSER_PLUGIN = 'browser_plugin';

    public const TIMEZONE = 'timezone';

    /**
     * @return array<string, mixed>
     */
    public static function normalized(): array
    {
        $db = [];
        foreach (AppSetting::query()->get(['name', 'value']) as $row) {
            $db[(string) $row->name] = AppSetting::decodeValue((string) $row->value);
        }

        return array_merge(self::defaults(), self::coerce($db));
    }

    /**
     * @return array<string, mixed>
     */
    private static function defaults(): array
    {
        return [
            self::BASE_URI => '/',
            self::FILES_ENABLED => true,
            self::CALENDAR_ENABLED => true,
            self::CONTACTS_ENABLED => true,
            self::TASKS_ENABLED => true,
            self::NOTES_ENABLED => true,
            self::AUTH_REALM => 'SabreDAV',
            self::BROWSER_PLUGIN => true,
            self::TIMEZONE => 'UTC',
            self::MAIL_IMAP_HOST => '',
            self::MAIL_IMAP_PORT => 993,
            self::MAIL_IMAP_SECURITY => 'ssl',
            self::MAIL_SMTP_HOST => '',
            self::MAIL_SMTP_PORT => 465,
            self::MAIL_SMTP_SECURITY => 'ssl',
        ];
    }

    /**
     * @param  array<string, mixed>  $db
     * @return array<string, mixed>
     */
    private static function coerce(array $db): array
    {
        $out = [];
        foreach (array_keys(self::defaults()) as $key) {
            if (! array_key_exists($key, $db)) {
                continue;
            }
            $out[$key] = match ($key) {
                self::MAIL_IMAP_PORT, self::MAIL_SMTP_PORT => (int) $db[$key],
                self::FILES_ENABLED, self::CALENDAR_ENABLED, self::CONTACTS_ENABLED, self::TASKS_ENABLED, self::NOTES_ENABLED, self::BROWSER_PLUGIN => (bool) $db[$key],
                self::TIMEZONE => TimezoneNormalizer::normalize($db[$key]),
                self::BASE_URI => self::normalizeBaseUri((string) $db[$key]),
                default => $db[$key],
            };
        }

        return $out;
    }

    private static function normalizeBaseUri(string $raw): string
    {
        $uri = html_entity_decode(trim($raw), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $uri = trim($uri, " \t\n\r\0\x0B\"'");
        if ($uri === '' || $uri === '/') {
            return '/';
        }
        if ($uri[0] !== '/') {
            $uri = '/'.$uri;
        }

        return rtrim($uri, '/').'/';
    }
}

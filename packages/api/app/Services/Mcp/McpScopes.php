<?php

declare(strict_types=1);

namespace App\Services\Mcp;

final class McpScopes
{
    public const DRIVE = 'drive';

    public const DOCS = 'docs';

    public const CALENDAR = 'calendar';

    public const TASKS = 'tasks';

    public const MAIL_READ = 'mail.read';

    public const MAIL_SEND = 'mail.send';

    public const CONTACTS = 'contacts';

    public const SETTINGS = 'settings';

    public const OFFLINE_ACCESS = 'offline_access';

    /**
     * @return array<string, string>
     */
    public static function descriptions(): array
    {
        return [
            self::DRIVE => 'Read and manage files in Drive',
            self::DOCS => 'Read and update Docs and Notes',
            self::CALENDAR => 'Read and manage calendars and events',
            self::TASKS => 'Read and manage tasks',
            self::MAIL_READ => 'Read mailboxes and messages',
            self::MAIL_SEND => 'Send mail as you',
            self::CONTACTS => 'Read contacts',
            self::SETTINGS => 'Read your profile and user settings',
            self::OFFLINE_ACCESS => 'Stay connected when you are offline (refresh token)',
        ];
    }

    /**
     * @return list<string>
     */
    public static function ids(): array
    {
        return array_keys(self::descriptions());
    }

    /**
     * @return list<string>
     */
    public static function defaultRequested(): array
    {
        return self::ids();
    }
}

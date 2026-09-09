<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use App\Models\User;

final class McpScopes
{
    public const CALENDAR_READ = 'calendar.read';

    public const CALENDAR_WRITE = 'calendar.write';

    public const NOTES_READ = 'notes.read';

    public const NOTES_WRITE = 'notes.write';

    public const CONTACTS_READ = 'contacts.read';

    public const CONTACTS_WRITE = 'contacts.write';

    public const TASKS_READ = 'tasks.read';

    public const TASKS_WRITE = 'tasks.write';

    public const DOCS_READ = 'docs.read';

    public const DOCS_WRITE = 'docs.write';

    public const DRIVE_READ = 'drive.read';

    public const DRIVE_WRITE = 'drive.write';

    public const MEET_READ = 'meet.read';

    public const MEET_WRITE = 'meet.write';

    public const MAIL_READ = 'mail.read';

    public const MAIL_SEND = 'mail.send';

    public const SETTINGS = 'settings';

    public const OFFLINE_ACCESS = 'offline_access';

    /** @deprecated Legacy alias: calendar.read + calendar.write */
    public const CALENDAR = 'calendar';

    /** @deprecated Legacy alias: drive.read + drive.write */
    public const DRIVE = 'drive';

    /** @deprecated Legacy alias: tasks.read + tasks.write */
    public const TASKS = 'tasks';

    /** @deprecated Legacy alias: contacts.read + contacts.write */
    public const CONTACTS = 'contacts';

    /** @deprecated Legacy alias: docs.read+write and notes.read+write */
    public const DOCS = 'docs';

    /**
     * Advertised OAuth scopes (consent, DCR, AS metadata).
     *
     * @return array<string, string>
     */
    public static function advertisedDescriptions(): array
    {
        return [
            self::CALENDAR_READ => 'Read calendars and events',
            self::CALENDAR_WRITE => 'Create, update, and delete calendars and events',
            self::NOTES_READ => 'Read notes and notebooks',
            self::NOTES_WRITE => 'Create, update, and delete notes and notebooks',
            self::CONTACTS_READ => 'Read contacts and address books',
            self::CONTACTS_WRITE => 'Create, update, and delete contacts',
            self::TASKS_READ => 'Read tasks and task lists',
            self::TASKS_WRITE => 'Create, update, and delete tasks and task lists',
            self::DOCS_READ => 'Read Docs files',
            self::DOCS_WRITE => 'Create, update, and delete Docs files',
            self::DRIVE_READ => 'Read Drive files',
            self::DRIVE_WRITE => 'Create, update, move, and delete Drive files',
            self::MEET_READ => 'Read Meet channels and messages',
            self::MEET_WRITE => 'Create, update, and delete Meet channels and messages',
            self::MAIL_READ => 'Read mailboxes and messages',
            self::MAIL_SEND => 'Send mail as you',
            self::SETTINGS => 'Read your profile and user settings',
            self::OFFLINE_ACCESS => 'Stay connected when you are offline (refresh token)',
        ];
    }

    /**
     * Legacy aliases so existing grants keep working. Not shown as the default consent set.
     *
     * @return array<string, string>
     */
    public static function legacyDescriptions(): array
    {
        return [
            self::CALENDAR => 'Read and write calendars and events (legacy grant)',
            self::DRIVE => 'Read and write Drive files (legacy grant)',
            self::TASKS => 'Read and write tasks and task lists (legacy grant)',
            self::CONTACTS => 'Read and write contacts (legacy grant)',
            self::DOCS => 'Read and write Docs and Notes (legacy grant)',
        ];
    }

    /**
     * Passport `tokensCan` map: advertised + legacy aliases.
     *
     * @return array<string, string>
     */
    public static function descriptions(): array
    {
        return array_merge(self::advertisedDescriptions(), self::legacyDescriptions());
    }

    /**
     * @return list<string>
     */
    public static function ids(): array
    {
        return array_keys(self::advertisedDescriptions());
    }

    /**
     * @return list<string>
     */
    public static function allRecognizedIds(): array
    {
        return array_keys(self::descriptions());
    }

    /**
     * Passport client allowlist (CIMD / DCR `oauth_clients.scopes`).
     *
     * Wider than {@see ids()} so a client snapshotted before a catalog change
     * can still request current advertised ids and leftover legacy aliases.
     * Consent still shows only the scopes the assistant actually requested.
     *
     * @return list<string>
     */
    public static function clientAllowlist(): array
    {
        return self::allRecognizedIds();
    }

    /**
     * @return list<string>
     */
    public static function defaultRequested(): array
    {
        return self::ids();
    }

    /**
     * @return list<array{label: string, scopes: list<string>}>
     */
    public static function consentGroups(): array
    {
        return [
            ['label' => 'Calendar', 'scopes' => [self::CALENDAR_READ, self::CALENDAR_WRITE]],
            ['label' => 'Notes', 'scopes' => [self::NOTES_READ, self::NOTES_WRITE]],
            ['label' => 'Contacts', 'scopes' => [self::CONTACTS_READ, self::CONTACTS_WRITE]],
            ['label' => 'Tasks', 'scopes' => [self::TASKS_READ, self::TASKS_WRITE]],
            ['label' => 'Docs', 'scopes' => [self::DOCS_READ, self::DOCS_WRITE]],
            ['label' => 'Drive', 'scopes' => [self::DRIVE_READ, self::DRIVE_WRITE]],
            ['label' => 'Meet', 'scopes' => [self::MEET_READ, self::MEET_WRITE]],
            ['label' => 'Mail', 'scopes' => [self::MAIL_READ, self::MAIL_SEND]],
            ['label' => 'Profile', 'scopes' => [self::SETTINGS]],
            ['label' => 'Connection', 'scopes' => [self::OFFLINE_ACCESS]],
        ];
    }

    /**
     * Group requested consent scopes by app (Read / Write). Legacy aliases attach to the same app.
     *
     * @param  iterable<mixed>  $scopes
     * @return list<array{label: string, scopes: list<mixed>}>
     */
    public static function groupConsentScopes(iterable $scopes): array
    {
        $byId = [];
        foreach ($scopes as $scope) {
            $id = self::scopeId($scope);
            if ($id !== '') {
                $byId[$id] = $scope;
            }
        }

        $legacyForGroup = [
            'Calendar' => self::CALENDAR,
            'Contacts' => self::CONTACTS,
            'Tasks' => self::TASKS,
            'Docs' => self::DOCS,
            'Drive' => self::DRIVE,
        ];

        $groups = [];
        foreach (self::consentGroups() as $def) {
            $items = [];
            foreach ($def['scopes'] as $id) {
                if (isset($byId[$id])) {
                    $items[] = $byId[$id];
                    unset($byId[$id]);
                }
            }
            $legacyId = $legacyForGroup[$def['label']] ?? null;
            if ($legacyId !== null && isset($byId[$legacyId])) {
                $items[] = $byId[$legacyId];
                unset($byId[$legacyId]);
            }
            if ($items !== []) {
                $groups[] = ['label' => $def['label'], 'scopes' => $items];
            }
        }
        if ($byId !== []) {
            $groups[] = ['label' => 'Other', 'scopes' => array_values($byId)];
        }

        return $groups;
    }

    /**
     * @param  list<string>  $granted
     */
    public static function grantedSatisfies(array $granted, string $required): bool
    {
        if (in_array($required, $granted, true)) {
            return true;
        }
        foreach (self::legacyAliasesFor($required) as $alias) {
            if (in_array($alias, $granted, true)) {
                return true;
            }
        }

        return false;
    }

    public static function tokenAllows(User $user, string $required): bool
    {
        if ($user->tokenCan($required)) {
            return true;
        }
        foreach (self::legacyAliasesFor($required) as $alias) {
            if ($user->tokenCan($alias)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return list<string>
     */
    public static function legacyAliasesFor(string $required): array
    {
        return match ($required) {
            self::CALENDAR_READ, self::CALENDAR_WRITE => [self::CALENDAR],
            self::DRIVE_READ, self::DRIVE_WRITE => [self::DRIVE],
            self::TASKS_READ, self::TASKS_WRITE => [self::TASKS],
            self::CONTACTS_READ, self::CONTACTS_WRITE => [self::CONTACTS],
            self::DOCS_READ, self::DOCS_WRITE => [self::DOCS],
            self::NOTES_READ, self::NOTES_WRITE => [self::DOCS],
            default => [],
        };
    }

    private static function scopeId(mixed $scope): string
    {
        if (is_string($scope)) {
            return $scope;
        }
        if (is_object($scope) && isset($scope->id) && is_string($scope->id)) {
            return $scope->id;
        }

        return '';
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars\Imip;

/**
 * IMAP folders as JMAP Mailbox objects (RFC 8621 §2) for vendor
 * `urn:wgw:jmap:mail` Mailbox/get: `id`, `name`, `parentId`, `role`,
 * `sortOrder` and `myRights`, the same shape as the standard so a later move
 * to `urn:ietf:params:jmap:mail` adds properties without renaming any.
 *
 * - The id is derived from the full IMAP name, so it is stable while the
 *   folder keeps its name, and the server can find the folder for an id.
 * - Rights are read-only: nothing here changes the mailbox.
 */
final class ImipMailboxObjects
{
    /** RFC 6154 special-use attributes → RFC 8621 roles (IANA "IMAP Mailbox Name Attributes"). */
    private const ROLES = [
        '\\all' => 'all',
        '\\archive' => 'archive',
        '\\drafts' => 'drafts',
        '\\flagged' => 'flagged',
        '\\important' => 'important',
        '\\junk' => 'junk',
        '\\sent' => 'sent',
        '\\trash' => 'trash',
    ];

    public static function id(string $folder): string
    {
        return 'M'.substr(hash('sha256', $folder), 0, 24);
    }

    /**
     * @param  list<ImapFolder>  $folders
     * @return array<string, array<string, mixed>> Mailbox objects keyed by id, in listing order
     */
    public static function fromFolders(array $folders): array
    {
        $names = [];
        foreach ($folders as $folder) {
            $names[$folder->name] = true;
        }
        $out = [];
        $rolesTaken = [];
        foreach ($folders as $folder) {
            [$parent, $leaf] = self::split($folder);
            $role = self::role($folder);
            // A role belongs to one Mailbox per account (RFC 8621 §2).
            if ($role !== null && isset($rolesTaken[$role])) {
                $role = null;
            }
            if ($role !== null) {
                $rolesTaken[$role] = true;
            }
            $id = self::id($folder->name);
            $out[$id] = [
                'id' => $id,
                'name' => $leaf,
                'parentId' => $parent !== null && isset($names[$parent]) ? self::id($parent) : null,
                'role' => $role,
                'sortOrder' => 0,
                'myRights' => self::readOnlyRights(),
            ];
        }

        return $out;
    }

    /**
     * Changes whenever a folder is added, removed, renamed or gets another role.
     *
     * @param  list<ImapFolder>  $folders
     */
    public static function state(array $folders): string
    {
        $parts = array_map(
            static fn (ImapFolder $folder): string => $folder->name."\0".($folder->delimiter ?? '')."\0".implode(' ', $folder->flags),
            $folders,
        );

        return substr(hash('sha256', implode("\n", $parts)), 0, 16);
    }

    /** @return array{0: ?string, 1: string} parent name and the folder's own name */
    private static function split(ImapFolder $folder): array
    {
        $delimiter = $folder->delimiter;
        if ($delimiter === null || $delimiter === '') {
            return [null, $folder->name];
        }
        $at = strrpos($folder->name, $delimiter);
        if ($at === false || $at === 0) {
            return [null, $folder->name];
        }

        return [substr($folder->name, 0, $at), substr($folder->name, $at + strlen($delimiter))];
    }

    private static function role(ImapFolder $folder): ?string
    {
        if ($folder->name === 'INBOX') {
            return 'inbox';
        }
        foreach ($folder->flags as $flag) {
            if (isset(self::ROLES[$flag])) {
                return self::ROLES[$flag];
            }
        }

        return null;
    }

    /** @return array<string, bool> RFC 8621 §2 MailboxRights */
    private static function readOnlyRights(): array
    {
        return [
            'mayReadItems' => true,
            'mayAddItems' => false,
            'mayRemoveItems' => false,
            'maySetSeen' => false,
            'maySetKeywords' => false,
            'mayCreateChild' => false,
            'mayRename' => false,
            'mayDelete' => false,
            'maySubmit' => false,
        ];
    }
}

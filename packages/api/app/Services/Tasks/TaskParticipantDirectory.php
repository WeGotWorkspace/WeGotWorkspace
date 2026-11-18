<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Services\Tasks\Conversion\TaskConversionSupport;

/**
 * Maps task participants to the people of the task's list (#2172), as one
 * reader may see them.
 *
 * Only the people of the list audience that the reader may see count
 * ({@see TaskListAudience::visibleTo}: themself, the list owners and their
 * Team colleagues; product owner, 2026-11-18). An address or username of
 * anyone else is never looked up, so a task cannot be used to learn who has an
 * account, or which address belongs to whom, across Teams.
 *
 * - An `e:` participant whose address is the email of someone the reader may
 *   see reads as that person's `u:` id.
 * - A `u:` participant the reader may see gets the name and address of that
 *   person's profile, whatever the stored line says, so a CalDAV client cannot
 *   make the app show one person under another's name.
 * - Every other participant reads as stored: a hidden member's address stays
 *   `e:` with the stored name, like an address with no account.
 *
 * With no reader, nobody is mapped (fail closed). The audience is looked up
 * once per list and reader for the lifetime of this object (one request); it
 * is never cached across requests.
 */
final class TaskParticipantDirectory
{
    /** @var array<string, array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>> */
    private array $audiences = [];

    public function __construct(private readonly TaskListAudience $audience) {}

    /**
     * Re-keys and fills participants from the audience of calendar `$calendarId`
     * that `$viewer` may see.
     * Order is kept; when a person is listed twice, the later entry is dropped
     * (first line wins).
     *
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    public function resolveTask(array $task, int $calendarId, ?string $viewer): array
    {
        $participants = $task['participants'] ?? null;
        if (! is_array($participants) || $participants === []) {
            return $task;
        }

        $members = $viewer === null ? [] : $this->audienceFor($calendarId, $viewer);
        $byEmail = self::membersByEmail($members);

        $resolved = [];
        foreach ($participants as $id => $entry) {
            $id = (string) $id;
            if (! is_array($entry)) {
                $resolved[$id] ??= $entry;

                continue;
            }
            $username = TaskConversionSupport::usernameFromParticipantId($id);
            $email = self::emailFromId($id);
            $member = $username !== null
                ? ($members[$username] ?? null)
                : ($email !== null ? ($byEmail[$email] ?? null) : null);
            if ($member === null) {
                $resolved[$id] ??= $entry;

                continue;
            }
            $userId = TaskConversionSupport::USER_ID_PREFIX.$member['username'];
            if (! isset($resolved[$userId])) {
                $resolved[$userId] = self::withProfile($entry, $member);
            }
        }
        $task['participants'] = $resolved;

        return $task;
    }

    /**
     * The person in `$members` whose email is `$email`, or null.
     *
     * @param  array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array{username: string, displayName: string, email: string|null, access: 'read'|'write'}|null
     */
    public static function memberForEmail(array $members, string $email): ?array
    {
        $email = strtolower(trim($email));

        return $email === '' ? null : (self::membersByEmail($members)[$email] ?? null);
    }

    /**
     * @param  array<string, mixed>  $entry
     * @param  array{username: string, displayName: string, email: string|null, access: 'read'|'write'}  $member
     * @return array<string, mixed>
     */
    private static function withProfile(array $entry, array $member): array
    {
        $entry['name'] = $member['displayName'];
        $entry['email'] = $member['email'] ?? $member['username'];
        $entry['username'] = $member['username'];

        return $entry;
    }

    /**
     * @return array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>
     */
    private function audienceFor(int $calendarId, string $viewer): array
    {
        $viewer = strtolower(trim($viewer));

        return $this->audiences[$calendarId."\n".$viewer] ??= $this->audience->visibleTo($calendarId, $viewer);
    }

    /**
     * @param  array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>
     */
    private static function membersByEmail(array $members): array
    {
        $byEmail = [];
        foreach ($members as $member) {
            $email = strtolower(trim((string) $member['email']));
            if ($email !== '') {
                $byEmail[$email] ??= $member;
            }
        }

        return $byEmail;
    }

    private static function emailFromId(string $id): ?string
    {
        if (! str_starts_with($id, TaskConversionSupport::EMAIL_ID_PREFIX)) {
            return null;
        }
        $email = strtolower(trim(substr($id, strlen(TaskConversionSupport::EMAIL_ID_PREFIX))));

        return $email !== '' ? $email : null;
    }
}

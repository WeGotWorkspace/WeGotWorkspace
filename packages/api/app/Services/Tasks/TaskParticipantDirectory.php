<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Services\Tasks\Conversion\TaskConversionSupport;

/**
 * Maps task participants to the people of the task's list (#2172).
 *
 * Only the list audience counts: an address or username of anyone else on
 * the instance is never looked up, so a task cannot be used to learn who has
 * an account, or which address belongs to whom, across Teams.
 *
 * - An `e:` participant whose address is the email of someone in the audience
 *   reads as that person's `u:` id.
 * - A `u:` participant in the audience gets the name and address of that
 *   person's profile, whatever the stored line says, so a CalDAV client cannot
 *   show one person under another's name.
 * - Every other participant reads as stored.
 *
 * The audience is looked up once per list for the lifetime of this object
 * (one request); it is never cached across requests.
 */
final class TaskParticipantDirectory
{
    /** @var array<int, array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>> */
    private array $audiences = [];

    public function __construct(private readonly TaskListAudience $audience) {}

    /**
     * Re-keys and fills participants from the audience of calendar `$calendarId`.
     * Order is kept; when a person is listed twice, the later entry is dropped
     * (first line wins).
     *
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    public function resolveTask(array $task, int $calendarId): array
    {
        $participants = $task['participants'] ?? null;
        if (! is_array($participants) || $participants === []) {
            return $task;
        }

        $members = $this->audienceForCalendar($calendarId);
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
        if ($member['email'] !== null) {
            $entry['email'] = $member['email'];
        }
        $entry['username'] = $member['username'];

        return $entry;
    }

    /**
     * @return array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>
     */
    private function audienceForCalendar(int $calendarId): array
    {
        return $this->audiences[$calendarId] ??= $this->audience->forCalendarId($calendarId);
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

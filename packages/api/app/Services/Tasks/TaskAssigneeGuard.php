<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Services\Tasks\Conversion\TaskConversionSupport;
use App\Services\Teams\TeamColleagues;

/**
 * Checks the assignees a REST or MCP write adds (#2172).
 *
 * Only ids this write adds are checked: the attendees of the result minus
 * those the stored task already has (every attendee on a create). An added
 * user must be in the target list's audience with write access; an added
 * address no account has passes. Attendees the task already has pass
 * unchecked, so a task with a native-client attendee or a former member still
 * saves. A move to another list drops the assignees who cannot see the target.
 *
 * For an added user the server writes the address and name from that user's
 * own profile, whatever the payload says. An address is matched to a user
 * only within the target list's audience, and the actor can assign only
 * themselves, the list owner or someone they share a Team with (the picker's
 * rule). The organizer (`roles: owner`) is set by the server only: the actor
 * when a task first gets an attendee, the mover when a move leaves it outside
 * the target audience. A payload cannot add or replace one.
 */
final class TaskAssigneeGuard
{
    public const INVALID_PARTICIPANT = 'invalid_participant';

    public const STALE_PARTICIPANT_ID = 'stale_participant_id';

    public function __construct(
        private readonly TaskListAudience $audience,
        private readonly TeamColleagues $colleagues,
    ) {}

    /**
     * Positional ids (`att1`, `att2`) predate stable ids; a patch keyed by one
     * could hit the wrong person, so it is refused.
     *
     * @param  array<string, mixed>  $patch
     */
    public function assertPatchUsesStableIds(array $patch): void
    {
        $participants = $patch['participants'] ?? null;
        if (! is_array($participants)) {
            return;
        }
        $stale = array_values(array_filter(
            array_map('strval', array_keys($participants)),
            static fn (string $id): bool => preg_match('/^att\d+$/', $id) === 1,
        ));
        if ($stale !== []) {
            throw new ApiHttpException(
                422,
                'Participant ids '.implode(', ', $stale).' are no longer used. Read the task again and use its participant ids.',
                self::STALE_PARTICIPANT_ID,
            );
        }
    }

    /**
     * @param  array<string, mixed>|null  $before  the stored task, null on a create
     * @param  array<string, mixed>  $after  the task about to be written
     * @param  string  $actor  the username of whoever writes
     * @param  CalendarInstance|null  $source  the list the task is stored in, for a move
     * @return array<string, mixed> `$after` with stable ids and server-written user details
     */
    public function prepare(
        ?array $before,
        array $after,
        CalendarInstance $target,
        string $actor,
        ?CalendarInstance $source = null,
    ): array {
        $participants = $after['participants'] ?? null;
        if (! is_array($participants)) {
            return $after;
        }
        $stored = is_array($before['participants'] ?? null) ? $before['participants'] : [];
        $audience = null;
        $members = function () use (&$audience, $target): array {
            return $audience ??= $this->audience->forList($target);
        };

        $canonical = [];
        $added = [];
        foreach ($participants as $id => $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id = (string) $id;
            $storedEntry = $stored[$id] ?? null;
            if (is_array($storedEntry) && TaskConversionSupport::isOwnerParticipant($storedEntry)) {
                // The organizer is whoever the stored task names; a write cannot change it.
                $canonical[$id] ??= $storedEntry;

                continue;
            }
            if (TaskConversionSupport::isOwnerParticipant($entry)) {
                throw $this->invalidParticipant();
            }
            if ($storedEntry !== null) {
                $canonical[$id] ??= $this->pinToStored($entry, $storedEntry, $id);

                continue;
            }
            $stableId = $this->stableAttendeeId($id, $entry, $members);
            if (array_key_exists($stableId, $stored)) {
                $canonical[$stableId] ??= $this->pinToStored($entry, $stored[$stableId], $stableId);

                continue;
            }
            if (! isset($canonical[$stableId])) {
                $canonical[$stableId] = $entry;
                $added[] = $stableId;
            }
        }

        $actor = strtolower(trim($actor));
        $canonical = $this->withCheckedUsers($canonical, $added, $members, $target, $actor);
        $moved = $source !== null && (int) $source->calendarid !== (int) $target->calendarid;
        if ($moved) {
            $canonical = $this->onlyTargetAudience($canonical, $members);
        }
        $after['participants'] = $this->withOrganizer($canonical, $stored, $members, $actor, $moved);

        return $after;
    }

    /**
     * A write cannot change who a stored id stands for: the stored address
     * (and, for a user, the stored name) replaces what the payload sent.
     *
     * @param  array<string, mixed>  $entry
     * @return array<string, mixed>
     */
    private function pinToStored(array $entry, mixed $stored, string $id): array
    {
        $stored = is_array($stored) ? $stored : [];
        unset($entry['email']);
        if (isset($stored['email'])) {
            $entry['email'] = $stored['email'];
        }
        if (TaskConversionSupport::usernameFromParticipantId($id) !== null) {
            unset($entry['name']);
            if (isset($stored['name'])) {
                $entry['name'] = $stored['name'];
            }
        }

        return $entry;
    }

    /**
     * The id an added attendee is stored under. An address reads as a user
     * only when it is the email of someone in the target list's audience;
     * anyone else's address stays `e:`, so no account is looked up outside it.
     *
     * @param  array<string, mixed>  $entry
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     */
    private function stableAttendeeId(string $id, array $entry, \Closure $members): string
    {
        $username = TaskConversionSupport::usernameFromParticipantId($id);
        if ($username !== null) {
            return TaskConversionSupport::USER_ID_PREFIX.$username;
        }
        // The address the writer stores decides who the id stands for.
        $email = is_string($entry['email'] ?? null) ? $entry['email'] : '';
        $email = strtolower(trim((string) preg_replace('/^mailto:/i', '', trim($email))));
        if ($email === '' && str_starts_with($id, TaskConversionSupport::EMAIL_ID_PREFIX)) {
            $email = strtolower(trim(substr($id, strlen(TaskConversionSupport::EMAIL_ID_PREFIX))));
        }
        if ($email === '') {
            return $id;
        }
        $member = TaskParticipantDirectory::memberForEmail($members(), $email);

        return $member !== null
            ? TaskConversionSupport::USER_ID_PREFIX.$member['username']
            : TaskConversionSupport::EMAIL_ID_PREFIX.$email;
    }

    /**
     * @param  array<string, array<string, mixed>>  $participants
     * @param  list<string>  $added
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array<string, mixed>>
     */
    private function withCheckedUsers(
        array $participants,
        array $added,
        \Closure $members,
        CalendarInstance $target,
        string $actor,
    ): array {
        $owners = null;
        foreach ($added as $id) {
            $username = TaskConversionSupport::usernameFromParticipantId($id);
            if ($username === null) {
                continue;
            }
            $member = $members()[$username] ?? null;
            if ($member === null || $member['access'] !== TaskListAudience::ACCESS_WRITE) {
                throw $this->invalidParticipant();
            }
            // The picker's rule: the actor, the list owner, or someone the actor
            // shares a Team with. Anyone else gets the same refusal, so a person
            // sharee cannot read a Team member's profile by guessing a username.
            $owners ??= array_flip($this->audience->ownerUsernames($target));
            if ($username !== $actor
                && ! isset($owners[$username])
                && ! $this->colleagues->sharesTeamIgnoringAdminRole($actor, $username)) {
                throw $this->invalidParticipant();
            }
            $participants[$id] = [
                ...$participants[$id],
                '@type' => 'Participant',
                'name' => $member['displayName'],
                'email' => $member['email'] ?? $username,
                'roles' => ['attendee'],
                'username' => $username,
            ];
        }

        return $participants;
    }

    /**
     * The organizer of a task with assignees (#2172, product owner 2026-11-18):
     * - once stored, it stays, whatever the payload sends or leaves out;
     * - the first time a task gets an attendee and has none, it is the actor;
     * - after a move to another audience, it becomes the actor when the stored
     *   organizer's address is no one's in the target audience.
     * The actor is always a person (a username), never a Team.
     *
     * @param  array<string, array<string, mixed>>  $participants
     * @param  array<string, mixed>  $stored
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array<string, mixed>>
     */
    private function withOrganizer(array $participants, array $stored, \Closure $members, string $actor, bool $moved): array
    {
        $organizerId = self::organizerId($participants);
        $storedId = self::organizerId($stored);
        if ($organizerId === null && $storedId !== null && is_array($stored[$storedId])) {
            $participants = [$storedId => $stored[$storedId]] + $participants;
            $organizerId = $storedId;
        }

        if ($organizerId !== null) {
            if (! $moved) {
                return $participants;
            }
            $email = is_string($participants[$organizerId]['email'] ?? null) ? $participants[$organizerId]['email'] : '';
            $email = (string) preg_replace('/^mailto:/i', '', trim($email));
            if (TaskParticipantDirectory::memberForEmail($members(), $email) !== null) {
                return $participants;
            }
            unset($participants[$organizerId]);
        } elseif (! self::hasAttendee($participants)) {
            return $participants;
        }

        $member = $members()[$actor] ?? null;
        if ($member === null || $member['email'] === null) {
            return $participants;
        }

        return ['org' => [
            '@type' => 'Participant',
            'name' => $member['displayName'],
            'email' => $member['email'],
            'roles' => ['owner'],
        ]] + $participants;
    }

    /**
     * @param  array<string, mixed>  $participants
     */
    private static function organizerId(array $participants): ?string
    {
        foreach ($participants as $id => $entry) {
            if (is_array($entry) && TaskConversionSupport::isOwnerParticipant($entry)) {
                return (string) $id;
            }
        }

        return null;
    }

    /**
     * @param  array<string, array<string, mixed>>  $participants
     */
    private static function hasAttendee(array $participants): bool
    {
        foreach ($participants as $entry) {
            if (! TaskConversionSupport::isOwnerParticipant($entry)) {
                return true;
            }
        }

        return false;
    }

    /**
     * A task moved to a list with another audience keeps only the assignees
     * who can see that list (#2172, finding 6): the name and address of anyone
     * else stay behind with the source list, as do outside addresses.
     *
     * @param  array<string, array<string, mixed>>  $participants
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array<string, mixed>>
     */
    private function onlyTargetAudience(array $participants, \Closure $members): array
    {
        return array_filter(
            $participants,
            static function (array $entry, string $id) use ($members): bool {
                if (TaskConversionSupport::isOwnerParticipant($entry)) {
                    return true;
                }
                $username = TaskConversionSupport::usernameFromParticipantId($id);

                return $username !== null && isset($members()[$username]);
            },
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /**
     * One fixed answer for every refused participant: it names no id, so it
     * tells nothing about who has an account.
     */
    private function invalidParticipant(): ApiHttpException
    {
        return new ApiHttpException(
            422,
            'Only people who can edit this task list can be assigned.',
            self::INVALID_PARTICIPANT,
        );
    }
}

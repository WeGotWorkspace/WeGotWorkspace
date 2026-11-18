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
 * only among the people of the target list the actor may see
 * ({@see TaskListAudience::visibleTo}): themselves, the list owner and their
 * Team colleagues, the picker's rule. A hidden member's address is stored as
 * an external `e:` guest, and a hidden member's `u:` id gets the same 422 as an
 * unknown one, so no answer tells whether an account exists. The organizer (`roles: owner`) is set by the server only: the actor
 * when a write first assigns someone, the mover when a move leaves it outside
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
        $stored = is_array($before['participants'] ?? null) ? $before['participants'] : [];
        if (! is_array($participants)) {
            if (self::organizerId($stored) === null) {
                return $after;
            }
            // A write that leaves the map out must not shed the stored organizer.
            $participants = [];
        }
        $actor = strtolower(trim($actor));
        $audience = null;
        $members = function () use (&$audience, $target): array {
            return $audience ??= $this->audience->forList($target);
        };
        // Whom the actor may see decides who an address stands for: a hidden
        // member's address is an external guest, exactly like an unknown one.
        $seen = null;
        $visible = function () use (&$seen, $target, $actor): array {
            return $seen ??= $this->audience->visibleTo((int) $target->calendarid, $actor);
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
            $stableId = $this->stableAttendeeId($id, $entry, $visible);
            if (array_key_exists($stableId, $stored)) {
                $canonical[$stableId] ??= $this->pinToStored($entry, $stored[$stableId], $stableId);

                continue;
            }
            if (! isset($canonical[$stableId])) {
                $canonical[$stableId] = $entry;
                $added[] = $stableId;
            }
        }

        $canonical = $this->withCheckedUsers($canonical, $added, $visible, $target, $actor);
        $moved = $source !== null && (int) $source->calendarid !== (int) $target->calendarid;
        if ($moved) {
            $canonical = $this->onlyTargetAudience($canonical, $members, $actor, $target);
        }
        $assigns = array_filter($added, static fn (string $id): bool => isset($canonical[$id])) !== [];
        $after['participants'] = $this->withOrganizer($canonical, $stored, $members, $actor, $moved, $assigns);

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
     * only when it is the email of someone in the target list's audience whom
     * the actor may see; anyone else's address stays `e:` and is stored as an
     * external guest, so the answer is the same as for an address with no
     * account (product owner, 2026-11-18).
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
        foreach ($added as $id) {
            $username = TaskConversionSupport::usernameFromParticipantId($id);
            if ($username === null) {
                continue;
            }
            $member = $members()[$username] ?? null;
            if ($member === null || ! $this->mayAssign($member, $actor, $target)) {
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
     * The picker's rule: write access, and the member is the actor, the list
     * owner, or someone the actor shares a Team with. Anyone else gets the same
     * refusal, so a person sharee cannot read a Team member's profile by
     * guessing a username.
     *
     * @param  array{username: string, displayName: string, email: string|null, access: 'read'|'write'}  $member
     */
    private function mayAssign(array $member, string $actor, CalendarInstance $target): bool
    {
        if ($member['access'] !== TaskListAudience::ACCESS_WRITE) {
            return false;
        }
        $username = $member['username'];
        if ($username === $actor) {
            return true;
        }

        return in_array($username, $this->audience->ownerUsernames($target), true)
            || $this->colleagues->sharesTeamIgnoringAdminRole($actor, $username);
    }

    /**
     * The organizer of a task with assignees (#2172, product owner 2026-11-18):
     * - once stored, it stays, whatever the payload sends or leaves out;
     * - when a write assigns someone and the task has none, it is the actor
     *   (a rename of a task whose attendees came from CalDAV names nobody);
     * - after a move to another audience, it becomes the actor when the stored
     *   organizer's address is no one's in the target audience.
     * The actor is always a person (a username), never a Team.
     *
     * @param  array<string, array<string, mixed>>  $participants
     * @param  array<string, mixed>  $stored
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array<string, mixed>>
     */
    private function withOrganizer(
        array $participants,
        array $stored,
        \Closure $members,
        string $actor,
        bool $moved,
        bool $assigns,
    ): array {
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
            if (self::inAudience($members(), $email)) {
                return $participants;
            }
            $replacement = self::actorOrganizer($members(), $actor);
            if ($replacement === null) {
                return $participants;
            }
            unset($participants[$organizerId]);

            return ['org' => $replacement] + $participants;
        }
        if (! $assigns) {
            // Only a write that assigns someone names the organizer.
            return $participants;
        }
        $replacement = self::actorOrganizer($members(), $actor);

        return $replacement === null ? $participants : ['org' => $replacement] + $participants;
    }

    /**
     * @param  array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, mixed>|null
     */
    private static function actorOrganizer(array $members, string $actor): ?array
    {
        $member = $members[$actor] ?? null;
        if ($member === null) {
            return null;
        }

        return [
            '@type' => 'Participant',
            'name' => $member['displayName'],
            'email' => $member['email'] ?? $member['username'],
            'roles' => ['owner'],
        ];
    }

    /**
     * An address is in the audience when it is a member's email or username.
     *
     * @param  array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     */
    private static function inAudience(array $members, string $address): bool
    {
        $address = strtolower(trim($address));
        if ($address === '') {
            return false;
        }
        if (TaskParticipantDirectory::memberForEmail($members, $address) !== null) {
            return true;
        }
        foreach ($members as $member) {
            if (strtolower($member['username']) === $address) {
                return true;
            }
        }

        return false;
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
     * A task moved to a list with another audience keeps only the assignees
     * who can see that list (#2172, finding 6): the name and address of anyone
     * else stay behind with the source list, as do outside addresses. A stored
     * address stays only when it is that of a member the actor could assign
     * there, so a move cannot turn it into an assignee the guard would refuse.
     *
     * @param  array<string, array<string, mixed>>  $participants
     * @param  \Closure(): array<string, array{username: string, displayName: string, email: string|null, access: 'read'|'write'}>  $members
     * @return array<string, array<string, mixed>>
     */
    private function onlyTargetAudience(array $participants, \Closure $members, string $actor, CalendarInstance $target): array
    {
        return array_filter(
            $participants,
            function (array $entry, string $id) use ($members, $actor, $target): bool {
                if (TaskConversionSupport::isOwnerParticipant($entry)) {
                    return true;
                }
                $username = TaskConversionSupport::usernameFromParticipantId($id);
                if ($username !== null) {
                    // Someone who can only view the target list cannot tick the task off.
                    return ($members()[$username]['access'] ?? null) === TaskListAudience::ACCESS_WRITE;
                }
                if (! str_starts_with($id, TaskConversionSupport::EMAIL_ID_PREFIX)) {
                    return false;
                }
                // An address of someone in the new audience reads as that person there.
                $email = substr($id, strlen(TaskConversionSupport::EMAIL_ID_PREFIX));

                $member = TaskParticipantDirectory::memberForEmail($members(), $email);

                return $member !== null && $this->mayAssign($member, $actor, $target);
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

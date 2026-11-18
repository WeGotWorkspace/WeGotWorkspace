<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Services\Tasks\Conversion\TaskConversionSupport;

/**
 * Checks the assignees a REST or MCP write adds (#2172).
 *
 * Only ids this write adds are checked: the attendees of the result minus
 * those the stored task already has (every attendee on a create). An added
 * user must be in the target list's audience with write access; an added
 * address no account has passes. Attendees the task already has pass
 * unchecked, so a task with a native-client attendee, a former member or an
 * assignee without access in a move target still saves.
 *
 * For an added user the server writes the address and name from that user's
 * own profile, whatever the payload says.
 */
final class TaskAssigneeGuard
{
    public const INVALID_PARTICIPANT = 'invalid_participant';

    public const STALE_PARTICIPANT_ID = 'stale_participant_id';

    public function __construct(
        private readonly TaskListAudience $audience,
        private readonly TaskParticipantDirectory $directory,
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
     * @return array<string, mixed> `$after` with stable ids and server-written user details
     */
    public function prepare(?array $before, array $after, CalendarInstance $target): array
    {
        $participants = $after['participants'] ?? null;
        if (! is_array($participants)) {
            return $after;
        }
        $stored = is_array($before['participants'] ?? null) ? $before['participants'] : [];

        $canonical = [];
        $added = [];
        foreach ($participants as $id => $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $id = (string) $id;
            if (array_key_exists($id, $stored)) {
                $canonical[$id] ??= $this->pinToStored($entry, $stored[$id], $id);

                continue;
            }
            if (TaskConversionSupport::isOwnerParticipant($entry)) {
                $canonical[$id] ??= $entry;

                continue;
            }
            $stableId = $this->stableAttendeeId($id, $entry);
            if (array_key_exists($stableId, $stored)) {
                $canonical[$stableId] ??= $this->pinToStored($entry, $stored[$stableId], $stableId);

                continue;
            }
            if (! isset($canonical[$stableId])) {
                $canonical[$stableId] = $entry;
                $added[] = $stableId;
            }
        }

        $after['participants'] = $this->withCheckedUsers($canonical, $added, $target);

        return $after;
    }

    /**
     * A write cannot change who a stored id stands for: the stored address
     * (and, for a user, the stored name) replaces what the payload sent.
     *
     * @param  array<string, mixed>  $entry
     * @param  mixed  $stored
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
     * @param  array<string, mixed>  $entry
     */
    private function stableAttendeeId(string $id, array $entry): string
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
        $username = $this->directory->usernameForEmail($email);

        return $username !== null
            ? TaskConversionSupport::USER_ID_PREFIX.$username
            : TaskConversionSupport::EMAIL_ID_PREFIX.$email;
    }

    /**
     * @param  array<string, array<string, mixed>>  $participants
     * @param  list<string>  $added
     * @return array<string, array<string, mixed>>
     */
    private function withCheckedUsers(array $participants, array $added, CalendarInstance $target): array
    {
        $audience = null;
        $rejected = [];
        foreach ($added as $id) {
            $username = TaskConversionSupport::usernameFromParticipantId($id);
            if ($username === null) {
                continue;
            }
            $audience ??= $this->audience->forList($target);
            $member = $audience[$username] ?? null;
            if ($member === null || $member['access'] !== TaskListAudience::ACCESS_WRITE) {
                $rejected[] = $id;

                continue;
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

        if ($rejected !== []) {
            throw new ApiHttpException(
                422,
                'Only people who can edit this task list can be assigned: '.implode(', ', $rejected).'.',
                self::INVALID_PARTICIPANT,
            );
        }

        return $participants;
    }
}

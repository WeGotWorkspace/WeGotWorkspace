<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Events\EventDispatch;
use App\Models\CalendarInstance;
use App\Services\Tasks\TaskChangeSet;
use App\Services\Tasks\TaskListAudience;

/**
 * `tasks.assigned` (#2172): tells each newly added assignee once.
 *
 * Recipients are the change set's added `u:` assignees who are in the list
 * audience with write access at the moment of the write, minus the actor.
 * An address that is no account here, or someone outside the audience, gets
 * nothing. The dedupe key is per task (and per recipient in the listener), with
 * supersede, so a reassign after an unassign replaces the old notice.
 */
final class TaskAssignedNotify
{
    public const ACTION = 'assigned';

    public function __construct(
        private readonly EventDispatch $eventDispatch,
        private readonly TaskListAudience $audience,
    ) {}

    /**
     * @param  array<string, mixed>  $task  the task after the write
     */
    public function notify(string $actor, CalendarInstance $list, array $task, TaskChangeSet $changes): void
    {
        $added = $changes->addedAssigneeUsernames();
        if ($added === [] || $changes->taskId === null) {
            return;
        }
        $actor = strtolower(trim($actor));
        $audience = $this->audience->forList($list);
        $recipients = [];
        foreach ($added as $username) {
            if ($username === $actor) {
                continue;
            }
            if (($audience[$username]['access'] ?? null) === TaskListAudience::ACCESS_WRITE) {
                $recipients[] = $username;
            }
        }
        if ($recipients === []) {
            return;
        }

        $this->eventDispatch->fireMutation(
            $actor,
            'tasks',
            self::ACTION,
            'tasks/'.$changes->taskId,
            self::eventData(
                TaskStatusChangedNotify::actorLabel($actor),
                trim((string) ($task['title'] ?? '')),
                $changes->taskId,
                $recipients,
            ),
        );
    }

    /**
     * @param  list<string>  $recipients
     * @return array{
     *     recipients: list<string>,
     *     actor: string,
     *     summary: string,
     *     taskId: string,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }
     */
    public static function eventData(
        string $actorLabel,
        string $summary,
        string $taskId,
        array $recipients,
    ): array {
        return [
            'recipients' => $recipients,
            'actor' => $actorLabel,
            'summary' => trim($summary),
            'taskId' => $taskId,
            'navigate' => self::navigate($taskId),
            'tag' => self::dedupeKey($taskId),
            'dedupe_key' => self::dedupeKey($taskId),
            'supersede' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        $summary = trim((string) ($data['summary'] ?? ''));

        return [
            'title' => ($actor !== '' ? $actor : 'Someone').' assigned you '.($summary !== '' ? $summary : 'a task'),
            'body' => null,
        ];
    }

    public static function dedupeKey(string $taskId): string
    {
        return 'tasks.assigned:'.trim($taskId);
    }

    /**
     * All Tasks with the task open. A list id is per user (a sharee sees
     * another id than the owner), the task id is the same for everyone, so the
     * link names only the task. It names the view too: a bare `/tasks`
     * redirects to the default view and drops the `task` query.
     */
    public static function navigate(string $taskId): string
    {
        return '/tasks/state/all?task='.rawurlencode($taskId);
    }
}

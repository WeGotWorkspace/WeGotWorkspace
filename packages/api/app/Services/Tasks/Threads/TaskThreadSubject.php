<?php

declare(strict_types=1);

namespace App\Services\Tasks\Threads;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Calendars\CollectionKind;
use App\Services\Notify\TaskAssignedNotify;
use App\Services\Tasks\Conversion\TaskConversionSupport;
use App\Services\Tasks\TaskListAudience;
use App\Services\Tasks\TaskListRepository;
use App\Services\Tasks\TaskRepository;
use App\Services\Threads\ThreadSubject;
use App\Services\Threads\ThreadSubjectType;
use App\Support\WgwSettings;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Threads on a task (#2173, spec.md "Thread subjects"). The history belongs
 * to the list: the key is the list's calendarid plus the task UID, so a move
 * starts a fresh thread and the old entries stay with the old audience.
 *
 * - Read access to the list reads the thread; write access posts (`canPost`).
 * - The task is found the way the task routes find it, so whoever gets 404
 *   on GET /tasks/items/{taskId} gets 404 on its thread too.
 * - The pool belongs to the list's owner (a user or a Team).
 */
final class TaskThreadSubject implements ThreadSubjectType
{
    public const TYPE = 'task';

    public function __construct(
        private readonly TaskRepository $tasks,
        private readonly TaskListRepository $taskLists,
        private readonly TaskListAudience $audience,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CalendarShareInvites $shareInvites,
    ) {}

    public function type(): string
    {
        return self::TYPE;
    }

    public function resolve(string $username, string $subjectId): ?ThreadSubject
    {
        if (! (bool) (WgwSettings::normalized()[WgwSettings::TASKS_ENABLED] ?? true)) {
            return null;
        }
        $located = $this->tasks->locate($username, $subjectId);
        if ($located === null) {
            return null;
        }

        return $this->subjectFor($located['instance'], $located['task'], ! $this->shareInvites->isReadOnly($located['instance']));
    }

    /**
     * The subject for a task the server just wrote, for hooks such as "moved
     * here". It is not a caller's view, so it cannot post.
     *
     * @param  array<string, mixed>  $task
     */
    public function forTask(CalendarInstance $list, array $task): ?ThreadSubject
    {
        return $this->subjectFor($list, $task, false);
    }

    public function audience(ThreadSubject $subject): array
    {
        $list = $this->listOf($subject);

        return $list === null ? [] : array_map('strval', array_keys($this->audience->forList($list)));
    }

    public function followers(ThreadSubject $subject): array
    {
        $task = is_array($subject->context) ? ($subject->context['task'] ?? null) : null;
        $participants = is_array($task) ? ($task['participants'] ?? null) : null;
        if (! is_array($participants)) {
            return [];
        }
        $usernames = [];
        foreach ($participants as $id => $entry) {
            if (! is_array($entry) || TaskConversionSupport::isOwnerParticipant($entry)) {
                continue;
            }
            $username = TaskConversionSupport::usernameFromParticipantId((string) $id);
            if ($username !== null) {
                $usernames[$username] = $username;
            }
        }

        return array_values($usernames);
    }

    public function readableScopes(string $username): array
    {
        $scopes = [];
        foreach ($this->collectionAccess->accessibleInstances($username, CollectionKind::TaskList) as $instance) {
            $scopes[(string) $instance->calendarid] = true;
        }

        return array_map('strval', array_keys($scopes));
    }

    public function notificationActions(): array
    {
        return ['activity' => 'tasks.thread_activity', 'mentioned' => 'tasks.mentioned'];
    }

    public function navigate(ThreadSubject $subject): string
    {
        return TaskAssignedNotify::navigate($subject->id);
    }

    /**
     * @param  array<string, mixed>  $task
     */
    private function subjectFor(CalendarInstance $list, array $task, bool $canPost): ?ThreadSubject
    {
        $uid = is_string($task['uid'] ?? null) ? $task['uid'] : '';
        $id = is_string($task['id'] ?? null) ? $task['id'] : '';
        $owner = CalendarInstance::query()
            ->where('calendarid', (int) $list->calendarid)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->orderBy('id')
            ->value('principaluri');
        if ($uid === '' || $id === '' || ! is_string($owner) || $owner === '') {
            return null;
        }

        return new ThreadSubject(
            type: self::TYPE,
            id: $id,
            localKey: $uid,
            scope: (string) (int) $list->calendarid,
            scopeId: $this->taskLists->apiIdForInstance($list),
            poolOwner: $owner,
            canPost: $canPost,
            context: ['list' => $list, 'task' => $task],
        );
    }

    private function listOf(ThreadSubject $subject): ?CalendarInstance
    {
        $list = is_array($subject->context) ? ($subject->context['list'] ?? null) : null;

        return $list instanceof CalendarInstance ? $list : null;
    }
}

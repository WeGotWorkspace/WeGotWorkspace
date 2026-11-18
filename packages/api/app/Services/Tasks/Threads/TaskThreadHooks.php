<?php

declare(strict_types=1);

namespace App\Services\Tasks\Threads;

use App\Models\CalendarInstance;
use App\Services\Tasks\TaskChangeSet;
use App\Services\Threads\ThreadLifecycle;
use App\Services\Threads\ThreadRepository;
use Illuminate\Support\Facades\Log;

/**
 * What a task write does to task threads (#2173, spec.md "Lifecycle hooks").
 *
 * - A move (REST, MCP, the web app or a CalDAV `MOVE`) writes "moved here"
 *   under the new key. The old entries stay under the old key.
 * - A delete deletes nothing: the entries stay hidden under the list's key
 *   and show again if the same UID comes back.
 * - Only the owner deleting a list removes its entries.
 *
 * It runs after the task write has committed and never fails it.
 */
final class TaskThreadHooks
{
    /**
     * Resolved per call: TaskRepository reaches this class through
     * TaskChangeReactions, and TaskThreadSubject needs TaskRepository.
     */
    public function __construct() {}

    /**
     * @param  array<string, mixed>|null  $after  null for a delete
     */
    public function afterWrite(string $actor, CalendarInstance $list, TaskChangeSet $changes, ?array $after): void
    {
        if ($after === null || ! $changes->moved()) {
            return;
        }
        $this->guard('moved', $changes->taskId, function () use ($actor, $list, $after): void {
            $subject = app(TaskThreadSubject::class)->forTask($list, $after);
            if ($subject !== null) {
                app(ThreadRepository::class)->appendActivity($subject, $actor, ['field' => 'moved']);
            }
        });
    }

    /** The list changed owner and kept its calendarid: its entries follow into the new owner's pool. */
    public function listTransferred(int $calendarId, string $newOwnerUri): void
    {
        $this->guard('list_transferred', (string) $calendarId, fn () => app(ThreadLifecycle::class)->scopeTransferred(TaskThreadSubject::TYPE, (string) $calendarId, $newOwnerUri));
    }

    /** The owner deleted the list: its task threads go with it. */
    public function listDeleted(int $calendarId): void
    {
        $this->guard('list_deleted', (string) $calendarId, fn () => app(ThreadLifecycle::class)->scopeDeleted(TaskThreadSubject::TYPE, (string) $calendarId));
    }

    private function guard(string $hook, ?string $id, \Closure $run): void
    {
        try {
            $run();
        } catch (\Throwable $e) {
            try {
                Log::error('task_thread_hook_failed', [
                    'hook' => $hook,
                    'id' => $id,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }
    }
}

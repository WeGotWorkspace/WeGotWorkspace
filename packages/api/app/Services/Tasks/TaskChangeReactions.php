<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\CalendarInstance;
use App\Services\Notify\TaskAssignedNotify;
use Illuminate\Support\Facades\Log;

/**
 * The one place a task write reacts to its change set (#2172). REST and MCP
 * writes reach it from {@see TaskRepository}, CalDAV writes from the DAV
 * `TaskChangeObserverPlugin`, so `tasks.assigned` fires the same way for all
 * three. Epic #2173 adds its activity log here.
 *
 * It runs after the write is stored and never fails it: a reaction that throws
 * is logged and dropped.
 */
final class TaskChangeReactions
{
    public function __construct(
        private readonly TaskAssignedNotify $assigned,
    ) {}

    /**
     * @param  array<string, mixed>|null  $before  null for a create
     * @param  array<string, mixed>|null  $after  null for a delete
     */
    public function afterWrite(string $actor, CalendarInstance $list, ?array $before, ?array $after): TaskChangeSet
    {
        $changes = TaskChangeSet::between($before, $after);
        if ($changes->isEmpty() || $after === null) {
            return $changes;
        }
        try {
            $this->assigned->notify($actor, $list, $after, $changes);
        } catch (\Throwable $e) {
            try {
                Log::error('task_change_reaction_failed', [
                    'reaction' => 'tasks.assigned',
                    'taskId' => $changes->taskId,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }

        return $changes;
    }
}

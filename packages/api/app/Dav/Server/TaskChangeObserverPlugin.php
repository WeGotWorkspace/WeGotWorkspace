<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CollectionKind;
use App\Services\Tasks\TaskChangeReactions;
use App\Services\Tasks\TaskListRepository;
use App\Services\Tasks\TaskMapper;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Log;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;

/**
 * The task change set for CalDAV writes (#2172), so a native client that adds
 * an assignee notifies them the same way the web app does
 * ({@see TaskChangeReactions}).
 *
 * - It only looks at objects in a `task_list` collection.
 * - It reads the stored object in `beforeWriteContent`, `beforeCreateFile` and
 *   `beforeUnbind`, after the ACL and CalDAV checks (priority 200), and writes
 *   nothing there.
 * - It acts in `afterMethod:PUT` and `afterMethod:DELETE`, only for a 2xx
 *   response and a signed-in user. A refused or failed write never reacts.
 * - A file with several VTODOs gives one change set per UID.
 * - A `MOVE` between task lists gives the same `moved` change set as a REST
 *   move (#2173): before is the source object, after the destination object.
 *   A `MOVE` out of or into a task list is a delete or a create there.
 * - It never fails the write: errors are logged, as in {@see EventDispatchPlugin}.
 */
final class TaskChangeObserverPlugin extends ServerPlugin
{
    private const PRIORITY = 200;

    private ?Server $server = null;

    /**
     * The stored content per path before this request wrote it; null for a new file.
     *
     * @var array<string, array{instance: CalendarInstance, raw: string|null}>
     */
    private array $pending = [];

    public function __construct(
        private readonly TaskMapper $mapper,
        private readonly TaskListRepository $taskLists,
    ) {}

    public function initialize(Server $server): void
    {
        $this->server = $server;
        $server->on('beforeWriteContent', [$this, 'beforeWriteContent'], self::PRIORITY);
        $server->on('beforeCreateFile', [$this, 'beforeCreateFile'], self::PRIORITY);
        $server->on('beforeUnbind', [$this, 'beforeUnbind'], self::PRIORITY);
        $server->on('afterMethod:PUT', [$this, 'afterWrite']);
        $server->on('afterMethod:DELETE', [$this, 'afterWrite']);
        $server->on('afterMethod:MOVE', [$this, 'afterMove']);
    }

    public function getPluginName(): string
    {
        return 'wgw-task-change-observer';
    }

    public function beforeWriteContent(string $path): void
    {
        $this->remember($path, true);
    }

    public function beforeCreateFile(string $path): void
    {
        $this->remember($path, false);
    }

    public function beforeUnbind(string $path): void
    {
        $this->remember($path, true);
    }

    public function afterWrite(RequestInterface $request, ResponseInterface $response): void
    {
        $path = trim((string) $request->getPath(), '/');
        $pending = $this->pending[$path] ?? null;
        unset($this->pending[$path]);
        $status = $response->getStatus();
        if ($pending === null || $status < 200 || $status >= 300) {
            return;
        }
        $actor = DavCurrentUsername::of($this->server);
        if ($actor === null) {
            return;
        }

        try {
            $instance = $pending['instance'];
            $listId = $this->taskLists->apiIdForInstance($instance);
            $objectUri = basename($path);
            $before = $this->tasksByUid($pending['raw'], $objectUri, $listId, $instance, $actor);
            $after = strtoupper($request->getMethod()) === 'DELETE'
                ? []
                : $this->tasksByUid($this->storedRaw($instance, $objectUri), $objectUri, $listId, $instance, $actor);
            // Resolved here, inside the guard, so a reaction that cannot even be
            // built is logged like any other failure instead of failing the PUT.
            $reactions = app(TaskChangeReactions::class);
            foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $uid) {
                $reactions->afterWrite($actor, $instance, $before[$uid] ?? null, $after[$uid] ?? null);
            }
        } catch (\Throwable $e) {
            try {
                Log::error('task_change_observer_failed', [
                    'path' => $path,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }
    }

    /**
     * Sabre copies and then deletes, because calendars are not `IMoveTarget`.
     * `beforeUnbind` remembered the source (and an overwritten destination).
     */
    public function afterMove(RequestInterface $request, ResponseInterface $response): void
    {
        $source = trim((string) $request->getPath(), '/');
        $pending = $this->pending[$source] ?? null;
        unset($this->pending[$source]);
        $status = $response->getStatus();
        if ($status < 200 || $status >= 300 || $this->server === null) {
            return;
        }
        $actor = DavCurrentUsername::of($this->server);
        if ($actor === null) {
            return;
        }

        try {
            $destination = trim($this->server->calculateUri((string) $request->getHeader('Destination')), '/');
            unset($this->pending[$destination]);
            $target = $this->taskListForObjectPath($destination);
            if ($pending === null && $target === null) {
                return;
            }
            $before = $pending === null
                ? []
                : $this->tasksByUid($pending['raw'], basename($source), $this->taskLists->apiIdForInstance($pending['instance']), $pending['instance'], $actor);
            $after = $target === null
                ? []
                : $this->tasksByUid($this->storedRaw($target, basename($destination)), basename($destination), $this->taskLists->apiIdForInstance($target), $target, $actor);
            $reactions = app(TaskChangeReactions::class);
            foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $uid) {
                // The destination list once the task is there; the source list for a move out.
                $list = isset($after[$uid]) ? $target : $pending['instance'] ?? null;
                if ($list instanceof CalendarInstance) {
                    $reactions->afterWrite($actor, $list, $before[$uid] ?? null, $after[$uid] ?? null);
                }
            }
        } catch (\Throwable $e) {
            try {
                Log::error('task_change_observer_failed', [
                    'path' => $source,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }
    }

    private function remember(string $path, bool $exists): void
    {
        $path = trim($path, '/');
        try {
            $instance = $this->taskListForObjectPath($path);
            if ($instance === null) {
                return;
            }
            $this->pending[$path] = [
                'instance' => $instance,
                'raw' => $exists ? $this->storedRaw($instance, basename($path)) : null,
            ];
        } catch (\Throwable $e) {
            try {
                Log::error('task_change_observer_failed', [
                    'path' => $path,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            } catch (\Throwable) {
            }
        }
    }

    /**
     * The task list instance of `calendars/{principal}/{list}/{object}`, or null
     * for any other path or collection kind.
     */
    private function taskListForObjectPath(string $path): ?CalendarInstance
    {
        if (! str_starts_with($path, 'calendars/')) {
            return null;
        }
        $segments = explode('/', substr($path, strlen('calendars/')));
        if (count($segments) < 3) {
            return null;
        }
        $objectUri = array_pop($segments);
        $listUri = array_pop($segments);
        if ($objectUri === '' || $listUri === '' || $listUri === 'inbox' || $listUri === 'outbox') {
            return null;
        }

        return CalendarInstance::query()
            ->where('principaluri', 'principals/'.implode('/', $segments))
            ->where('uri', $listUri)
            ->whereHas('calendar', static fn (Builder $query) => $query->ofKind(CollectionKind::TaskList))
            ->first();
    }

    private function storedRaw(CalendarInstance $instance, string $objectUri): ?string
    {
        $object = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('uri', $objectUri)
            ->first(['calendardata']);
        if ($object === null) {
            return null;
        }

        return is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function tasksByUid(?string $raw, string $objectUri, string $listId, CalendarInstance $instance, string $actor): array
    {
        if ($raw === null || trim($raw) === '') {
            return [];
        }
        $object = new CalendarObject;
        $object->uri = $objectUri;
        $object->calendardata = $raw;
        // The list's audience, as the writer may see it, decides who an
        // attendee address stands for: a hidden member's address is a guest
        // to them and is not notified, as on REST.
        $object->calendarid = (int) $instance->calendarid;
        $byUid = [];
        foreach ($this->mapper->forViewer($actor)->toTasks($object, $listId) as $task) {
            $uid = is_string($task['uid'] ?? null) ? $task['uid'] : '';
            $byUid[$uid] ??= $task;
        }

        return $byUid;
    }
}

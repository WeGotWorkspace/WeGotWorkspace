<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\RecurrenceRuleGuard;
use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;
use App\Services\VObject\ICalendarUidGroupSplitter;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Import the VTODO UID groups of an ICS file into one task list (#1624).
 *
 * Mirrors Calendar's import: one transaction per UID group, each group's ICS
 * stored as-is so CalDAV clients keep RELATED-TO, VALARM, RRULE and unknown
 * properties. A failing group becomes one errors[] entry; the rest still imports.
 */
final class TaskImportService
{
    private const DOMAIN = 'tasks';

    public function __construct(
        private readonly WgwCalendarBackendFactory $backends,
        private readonly TaskMapper $mapper,
        private readonly TaskListRepository $taskLists,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly SearchIndexerService $searchIndexer,
        private readonly BestEffortSearchIndexSync $searchIndexSync = new BestEffortSearchIndexSync,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /**
     * @return array{
     *     list: list<array<string, mixed>>,
     *     errors: list<array{index: int, message: string, code?: string, uid?: string, title?: string}>,
     *     skipped: array{events: int}
     * }
     */
    public function importFromIcs(string $username, string $icsText, string $taskListId): array
    {
        Log::withContext(['principal' => $username]);

        $instance = $this->taskLists->findAccessibleTaskList($username, $taskListId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Task list not found.', 'not_found');
        }
        $this->collectionAccess->assertCollectionWritable($instance, 'This task list is read-only.');

        $guard = new VObjectPayloadGuard;
        $guard->assertIcsImportSize($icsText, self::DOMAIN);

        try {
            $split = ICalendarUidGroupSplitter::split($icsText, 'VTODO');
        } catch (\InvalidArgumentException $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'bad_request');
        }
        if ($split['groups'] === []) {
            throw new ApiHttpException(400, 'No VTODO data found.', 'bad_request');
        }

        $listId = $this->taskLists->apiIdForInstance($instance);
        $list = [];
        $errors = [];
        foreach ($split['groups'] as $index => $group) {
            try {
                foreach ($this->importGroup($username, $instance, $listId, $group, $guard) as $task) {
                    $list[] = $task;
                }
            } catch (\Throwable $exception) {
                $errors[] = self::errorEntry($index, $group, $exception);
            }
        }

        return [
            'list' => $list,
            'errors' => $errors,
            'skipped' => ['events' => $split['skipped']['VEVENT'] ?? 0],
        ];
    }

    /**
     * @param  array{uid: string, ics: string}  $group
     * @return list<array<string, mixed>>
     */
    private function importGroup(
        string $username,
        CalendarInstance $instance,
        string $listId,
        array $group,
        VObjectPayloadGuard $guard,
    ): array {
        RecurrenceRuleGuard::assertAllowed($guard->readICalendar($group['ics'], self::DOMAIN));

        $calendarId = (int) $instance->calendarid;
        [$objectUri, $tasks] = DB::connection('wgw')->transaction(
            function () use ($username, $instance, $calendarId, $listId, $group): array {
                CalendarInstance::query()->whereKey($instance->getKey())->lockForUpdate()->first();
                $this->assertUidIsNew($calendarId, $group['uid']);

                $objectUri = $this->allocateObjectUri($calendarId, self::summary($group['ics']));
                $this->backends->calBackend()->createCalendarObject(
                    [$calendarId, (int) $instance->id],
                    $objectUri,
                    $group['ics'],
                );
                $davPath = $this->davPath($username, $instance, $objectUri);
                $this->searchIndexSync->sync(
                    self::DOMAIN,
                    fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
                    $davPath,
                    $username,
                );

                $object = $this->findObject($calendarId, $objectUri);
                if ($object === null) {
                    throw new ApiHttpException(500, 'Could not load imported task.', 'server_error');
                }

                return [$objectUri, $this->mapper->toTasks($object, $listId)];
            },
        );

        $this->eventDispatch->fireMutation($username, self::DOMAIN, 'created', $this->davPath($username, $instance, $objectUri));

        return $tasks;
    }

    private function assertUidIsNew(int $calendarId, string $uid): void
    {
        $exists = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->exists();
        if ($exists) {
            throw new ApiHttpException(409, 'A task with this UID already exists in this list.', 'already_exists');
        }
    }

    private function allocateObjectUri(int $calendarId, string $title): string
    {
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $candidate = TaskMapper::generateObjectUri(['title' => $title]);
            if ($this->findObject($calendarId, $candidate) === null) {
                return $candidate;
            }
        }

        throw new ApiHttpException(500, 'Could not allocate task id.', 'server_error');
    }

    private function findObject(int $calendarId, string $objectUri): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uri', $objectUri)
            ->first();
    }

    private function davPath(string $username, CalendarInstance $instance, string $objectUri): string
    {
        return 'calendars/'.$username.'/'.$instance->uri.'/'.$objectUri;
    }

    /**
     * @param  array{uid: string, ics: string}  $group
     * @return array{index: int, message: string, code?: string, uid?: string, title?: string}
     */
    private static function errorEntry(int $index, array $group, \Throwable $exception): array
    {
        $entry = ['index' => $index];
        if ($exception instanceof ApiHttpException) {
            $entry['message'] = $exception->getMessage();
            $code = $exception->errorCode();
            if (is_string($code) && $code !== '') {
                $entry['code'] = $code;
            }
        } else {
            $entry['message'] = 'Could not import task.';
        }
        $entry['uid'] = $group['uid'];
        $title = self::summary($group['ics']);
        if ($title !== '') {
            $entry['title'] = $title;
        }

        return $entry;
    }

    /** First SUMMARY in the group, unescaped; empty when there is none. */
    private static function summary(string $ics): string
    {
        $unfolded = preg_replace('/\r?\n[ \t]/', '', $ics) ?? $ics;
        if (preg_match('/^SUMMARY(?:;[^:\r\n]*)?:(.*)$/mi', $unfolded, $matches) !== 1) {
            return '';
        }

        return trim(strtr(rtrim($matches[1], "\r"), ['\\,' => ',', '\\;' => ';', '\\n' => ' ', '\\N' => ' ', '\\\\' => '\\']));
    }
}

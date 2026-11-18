<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Services\Collab\CollabTextState;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use Illuminate\Database\Eloquent\Model;

/**
 * The live title and description of a task (#2208), on the live-text core
 * Notes uses. The save is a title and description patch on the shared task
 * write path, so every rule of a REST `PATCH` runs for it too.
 */
final class TaskTextCollaboration
{
    public function __construct(
        private readonly TaskRepository $tasks,
        private readonly TaskLocator $locator,
        private readonly TaskTextFields $fields,
        private readonly CollabTextState $core,
    ) {}

    /**
     * The text the room seeds from, the room key, and the tags a first save
     * names: `contentTag` (sent as the response ETag) and `objectEtag`.
     *
     * @return array{title: string, description: string, room: string, objectEtag: string, contentTag: string}
     */
    public function text(string $username, string $taskId): array
    {
        [$object, $fields] = $this->locate($username, $taskId);
        $text = $fields->text($object);

        return [
            'title' => $text['title'],
            'description' => $text['description'],
            'room' => self::roomKey((int) $object->calendarid, $text['uid']),
            'objectEtag' => $this->core->objectEtag($object),
            'contentTag' => $this->core->contentTag($fields, $object),
        ];
    }

    /**
     * Raw Yjs bytes of the task's stored state, or null when it has none.
     *
     * @return array{bytes: string, etag: string, externalWrite: bool}|null
     */
    public function yjsSnapshot(string $username, string $taskId): ?array
    {
        [$object, $fields] = $this->locate($username, $taskId);
        $row = $fields->findState($object);
        if ($row === null) {
            return null;
        }

        return [
            'bytes' => $this->core->stateBytes($row),
            'etag' => $this->core->stateEtag($row),
            'externalWrite' => $this->core->isExternalContentWrite($fields, $row, $object),
        ];
    }

    /**
     * Save the title, description and state; returns the new state tag.
     * Without a stored state the save must name, in `X-Wgw-External-Write`,
     * the content tag it seeded from: the core refuses it when the text has
     * moved on since.
     */
    public function put(
        string $username,
        string $taskId,
        string $title,
        string $description,
        string $bytes,
        ?string $ifMatch,
        ?string $ifNoneMatch,
        ?string $externalWriteSeen,
    ): string {
        $fields = $this->fields->forComponent(IcsJmapTaskConverter::parseTaskId($taskId)['vtodoUid']);
        $etag = '';
        $this->tasks->patchText(
            $username,
            $taskId,
            ['title' => $title, 'description' => $description === '' ? null : $description],
            function (CalendarObject $object, ?Model $state) use ($fields, $bytes, $ifMatch, $ifNoneMatch, $externalWriteSeen): void {
                $this->core->assertStatePrecondition($ifMatch, $ifNoneMatch, $state === null ? null : $this->core->stateEtag($state));
                if ($state === null && trim((string) $externalWriteSeen) === '') {
                    throw new ApiHttpException(
                        428,
                        'A first save must name the text it started from in X-Wgw-External-Write.',
                        'precondition_required',
                    );
                }
                $this->core->assertNoUnseenExternalWrite($fields, $state, $object, $externalWriteSeen);
                $this->core->assertStateSize($fields, $bytes);
            },
            function (CalendarObject $updated) use ($fields, $bytes, &$etag): void {
                $etag = $this->core->store($fields, $updated, $bytes);
            },
        );

        return $etag;
    }

    /** `task:<calendarid>:<vtodo-uid>`: the calendar row is the same for every sharee. */
    public static function roomKey(int $calendarId, string $vtodoUid): string
    {
        return 'task:'.$calendarId.':'.$vtodoUid;
    }

    /**
     * @return array{0: CalendarObject, 1: TaskTextFields}
     */
    private function locate(string $username, string $taskId): array
    {
        $located = $this->locator->find($username, $taskId);
        if ($located === null) {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }

        return [$located['object'], $this->fields->forComponent($located['vtodoUid'])];
    }
}

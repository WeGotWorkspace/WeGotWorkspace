<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Models\TaskYjsState;
use App\Services\Collab\CollabTextFields;

/**
 * Tasks' live text (#2208): DESCRIPTION then SUMMARY of one VTODO, stored in
 * `task_yjs_state` under the component's real UID. `$vtodoUid` is the id's
 * component part, null for a single-VTODO object.
 */
final class TaskTextFields implements CollabTextFields
{
    /** The largest state a task stores (spec: Shared server core). */
    public const MAX_STATE_BYTES = 262_144;

    public function __construct(
        private readonly TaskMapper $mapper,
        private readonly ?string $vtodoUid = null,
    ) {}

    public function forComponent(?string $vtodoUid): self
    {
        return new self($this->mapper, $vtodoUid);
    }

    /** @return array{title: string, description: string, uid: string} */
    public function text(CalendarObject $object): array
    {
        // A VTODO without a UID (only a row written straight to the database)
        // has no state row and no room; its other writes still work.
        $task = $this->mapper->toTask($object, '', $this->vtodoUid) ?? [];
        $uid = is_string($task['uid'] ?? null) ? $task['uid'] : '';

        return [
            'title' => is_string($task['title'] ?? null) ? $task['title'] : '',
            'description' => is_string($task['description'] ?? null) ? $task['description'] : '',
            'uid' => $uid,
        ];
    }

    #[\Override]
    public function textFields(CalendarObject $object): array
    {
        $text = $this->text($object);

        return [$text['description'], $text['title']];
    }

    #[\Override]
    public function findState(CalendarObject $object): ?TaskYjsState
    {
        $uid = $this->text($object)['uid'];

        return $uid === '' ? null : TaskYjsState::query()
            ->where('calendar_object_id', (int) $object->id)
            ->where('vtodo_uid', $uid)
            ->first();
    }

    #[\Override]
    public function storeState(CalendarObject $object, array $columns): void
    {
        $uid = $this->text($object)['uid'];
        if ($uid === '') {
            throw new ApiHttpException(404, 'Task not found.', 'not_found');
        }
        TaskYjsState::query()->updateOrCreate(
            ['calendar_object_id' => (int) $object->id, 'vtodo_uid' => $uid],
            $columns,
        );
    }

    #[\Override]
    public function maxStateBytes(): int
    {
        return self::MAX_STATE_BYTES;
    }
}

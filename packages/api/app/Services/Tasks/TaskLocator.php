<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CollectionKind;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;

/**
 * Finds a task the caller can reach: by its REST id, or by the calendar and
 * VTODO UID a live-text room key names (#2208).
 */
final class TaskLocator
{
    /** Files whose text holds a room's UID that are parsed on one join, poll or send. */
    private const MAX_TEXT_CANDIDATES = 20;

    public function __construct(
        private readonly TaskListRepository $taskLists,
        private readonly DriveGroupResolver $groups,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly TaskMapper $mapper,
    ) {}

    /**
     * The task a live-text room key names (#2208): `task:`, a decimal
     * calendar id, `:`, then the whole remainder as the VTODO UID. Null for
     * a malformed key, an unknown task, or a list the caller cannot reach
     * (hidden and dismissed shares included).
     *
     * @return array{object: CalendarObject, instance: CalendarInstance}|null
     */
    public function findForRoom(string $username, string $room): ?array
    {
        if (preg_match('/\Atask:([0-9]+):(.+)\z/s', $room, $matches) !== 1) {
            return null;
        }
        $calendarId = (int) $matches[1];
        $uid = $matches[2];

        $instance = $this->instanceFor(
            $username,
            $calendarId,
            CalendarInstance::query()
                ->where('calendarid', $calendarId)
                ->whereIn('principaluri', $this->accessiblePrincipalUris($username))
                ->pluck('id')
                ->all(),
        );
        if ($instance === null) {
            return null;
        }

        // The object's own `uid` first. A second VTODO in a file is not the
        // object's `uid`, so a capped LIKE with the wildcards escaped finds
        // it; the component check below decides either way.
        $byUid = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->orderBy('id')
            ->get();
        $match = $this->firstWithComponent($byUid, $uid);
        if ($match !== null) {
            return ['object' => $match, 'instance' => $instance];
        }
        $pattern = '%'.strtr($uid, ['!' => '!!', '%' => '!%', '_' => '!_']).'%';
        $byText = CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', '!=', $uid)
            ->whereRaw("calendardata LIKE ? ESCAPE '!'", [$pattern])
            ->orderBy('id')
            ->limit(self::MAX_TEXT_CANDIDATES)
            ->get();
        $match = $this->firstWithComponent($byText, $uid);
        if ($match !== null) {
            return ['object' => $match, 'instance' => $instance];
        }

        return null;
    }

    /**
     * @return array{
     *     object: CalendarObject,
     *     instance: CalendarInstance,
     *     taskListUri: string,
     *     vtodoUid: string|null
     * }|null
     */
    public function find(string $username, string $taskId): ?array
    {
        $parsed = IcsJmapTaskConverter::parseTaskId($taskId);
        $objectUri = $parsed['objectUri'];
        $vtodoUid = $parsed['vtodoUid'];

        $rows = CalendarObject::query()
            ->from('calendarobjects as o')
            ->join('calendars as c', 'c.id', '=', 'o.calendarid')
            ->join('calendarinstances as i', 'i.calendarid', '=', 'c.id')
            ->where('o.uri', $objectUri)
            ->whereIn('i.principaluri', $this->accessiblePrincipalUris($username))
            ->where('c.components', 'like', '%VTODO%')
            ->select([
                'o.id',
                'i.id as instance_id',
            ])
            ->get();

        if ($rows->isEmpty()) {
            return null;
        }

        $objectId = (int) $rows->first()->id;
        $object = CalendarObject::query()->find($objectId);
        if ($object === null) {
            return null;
        }

        $instance = $this->instanceFor(
            $username,
            (int) $object->calendarid,
            $rows->where('id', $objectId)->pluck('instance_id')->all(),
        );
        if ($instance === null) {
            return null;
        }

        return [
            'object' => $object,
            'instance' => $instance,
            'taskListUri' => $this->taskLists->apiIdForInstance($instance),
            'vtodoUid' => $vtodoUid,
        ];
    }

    /**
     * The instance a task in this calendar is reached through: the one the
     * task list overview shows, else the strongest of the given instances of
     * this list. A dismissed or hidden share is skipped either way.
     *
     * @param  array<mixed>  $candidateInstanceIds
     */
    private function instanceFor(string $username, int $calendarId, array $candidateInstanceIds): ?CalendarInstance
    {
        return $this->collectionAccess->accessibleInstances($username, CollectionKind::TaskList)
            ->first(fn (CalendarInstance $listed): bool => (int) $listed->calendarid === $calendarId)
            ?? $this->collectionAccess->visibleHighestAccess(
                $username,
                CalendarInstance::query()->whereIn('id', $candidateInstanceIds)->orderBy('id')->get(),
            )->first();
    }

    /**
     * @param  iterable<CalendarObject>  $objects
     */
    private function firstWithComponent(iterable $objects, string $uid): ?CalendarObject
    {
        foreach ($objects as $object) {
            if (($this->mapper->toTask($object, '', $uid)['uid'] ?? null) === $uid) {
                return $object;
            }
        }

        return null;
    }

    /**
     * @return list<string>
     */
    private function accessiblePrincipalUris(string $username): array
    {
        $uris = [$this->principalUri($username)];
        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $uris[] = AdminConstants::GROUP_PREFIX.$slug;
        }

        return $uris;
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }
}

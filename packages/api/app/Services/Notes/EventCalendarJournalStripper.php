<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use RuntimeException;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Strips VJOURNAL from event/group calendars and moves stray journal objects
 * into the default notebook ({@see CalendarCollectionUris::NOTE_GENERAL}).
 */
final class EventCalendarJournalStripper
{
    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $collectionsProvisioner,
    ) {}

    /**
     * @return array{scanned: int, stripped: int, movedObjects: int, skipped: int}
     */
    public function stripAll(): array
    {
        if (! Schema::connection('wgw')->hasTable('calendars')) {
            return ['scanned' => 0, 'stripped' => 0, 'movedObjects' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $stripped = 0;
        $movedObjects = 0;
        $skipped = 0;

        Calendar::query()
            ->orderBy('id')
            ->get()
            ->each(function (Calendar $calendar) use (&$scanned, &$stripped, &$movedObjects, &$skipped): void {
                $scanned++;
                $result = $this->stripCalendar($calendar);
                if ($result['stripped']) {
                    $stripped++;
                    $movedObjects += $result['movedObjects'];
                } else {
                    $skipped++;
                }
            });

        return [
            'scanned' => $scanned,
            'stripped' => $stripped,
            'movedObjects' => $movedObjects,
            'skipped' => $skipped,
        ];
    }

    /**
     * @return array{stripped: bool, movedObjects: int}
     */
    public function stripCalendar(Calendar $calendar): array
    {
        if (! $calendar->supportsVevent() || ! $calendar->supportsVjournal()) {
            return ['stripped' => false, 'movedObjects' => 0];
        }

        $movedObjects = $this->moveToOwnerNotebook($calendar, skipUidCollisions: false)['moved'];

        $kept = array_values(array_filter(
            array_map('trim', explode(',', (string) $calendar->components)),
            static fn (string $component): bool => $component !== '' && $component !== 'VJOURNAL',
        ));
        $calendar->components = implode(',', $kept);
        $calendar->save();

        return ['stripped' => true, 'movedObjects' => $movedObjects];
    }

    /**
     * Moves VJOURNAL objects out of calendars that no longer accept them.
     * Before #1772 an update left the default calendar VEVENT-only before
     * {@see stripAll()} ran, so its notes stayed there, out of Notes' sight
     * (#1779). A UID the notebook already holds is logged and left in place:
     * this runs inside a migration, where a throw blocks every later one.
     *
     * @return array{scanned: int, repaired: int, movedObjects: int, collisions: int}
     */
    public function repairStranded(): array
    {
        $result = ['scanned' => 0, 'repaired' => 0, 'movedObjects' => 0, 'collisions' => 0];
        if (! Schema::connection('wgw')->hasTable('calendars') || ! Schema::connection('wgw')->hasTable('calendarobjects')) {
            return $result;
        }

        $calendarIds = CalendarObject::query()
            ->where('componenttype', 'VJOURNAL')
            ->distinct()
            ->pluck('calendarid');

        Calendar::query()
            ->whereIn('id', $calendarIds)
            ->orderBy('id')
            ->get()
            ->each(function (Calendar $calendar) use (&$result): void {
                // An empty set is Sabre's "anything goes"; a set with
                // VJOURNAL is a notebook or left to stripAll().
                if (trim((string) $calendar->components) === '' || $calendar->supportsVjournal()) {
                    return;
                }
                $result['scanned']++;
                $moved = $this->moveToOwnerNotebook($calendar, skipUidCollisions: true);
                $result['movedObjects'] += $moved['moved'];
                $result['collisions'] += $moved['collisions'];
                if ($moved['moved'] > 0) {
                    $result['repaired']++;
                }
            });

        return $result;
    }

    /**
     * The owner (sharee-owner instance first) decides the target notebook.
     *
     * @return array{moved: int, collisions: int}
     */
    private function moveToOwnerNotebook(Calendar $calendar, bool $skipUidCollisions): array
    {
        $ownerInstance = CalendarInstance::query()
            ->where('calendarid', $calendar->id)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->orderBy('id')
            ->first()
            ?? CalendarInstance::query()
                ->where('calendarid', $calendar->id)
                ->orderBy('id')
                ->first();
        if ($ownerInstance === null) {
            return ['moved' => 0, 'collisions' => 0];
        }

        $principalUri = (string) $ownerInstance->principaluri;
        $notebook = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', $this->ensureNotebookForPrincipal($principalUri))
            ->first();
        if ($notebook === null) {
            return ['moved' => 0, 'collisions' => 0];
        }

        return $this->moveJournals((int) $calendar->id, $ownerInstance, $notebook, $skipUidCollisions);
    }

    /**
     * @return array{moved: int, collisions: int}
     */
    private function moveJournals(
        int $sourceCalendarId,
        CalendarInstance $source,
        CalendarInstance $notebook,
        bool $skipUidCollisions,
    ): array {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $sourceId = [(int) $source->calendarid, (int) $source->id];
        $targetId = [(int) $notebook->calendarid, (int) $notebook->id];
        $existingUris = [];
        $existingUids = [];
        CalendarObject::query()
            ->where('calendarid', (int) $notebook->calendarid)
            ->get(['uri', 'uid'])
            ->each(function (CalendarObject $row) use (&$existingUris, &$existingUids): void {
                $existingUris[(string) $row->uri] = true;
                $uid = trim((string) $row->uid);
                if ($uid !== '') {
                    $existingUids[$uid] = true;
                }
            });

        $moved = 0;
        $collisions = 0;
        CalendarObject::query()
            ->where('calendarid', $sourceCalendarId)
            ->where('componenttype', 'VJOURNAL')
            ->orderBy('id')
            ->get()
            ->each(function (CalendarObject $object) use (
                $caldav,
                $sourceId,
                $targetId,
                &$existingUris,
                &$existingUids,
                &$moved,
                &$collisions,
                $skipUidCollisions,
            ): void {
                $objectUri = (string) $object->uri;
                $sourceUid = trim((string) $object->uid);
                if ($sourceUid !== '' && isset($existingUids[$sourceUid]) && $skipUidCollisions) {
                    Log::warning('Left a note in its calendar: its uid is already in the notebook.', [
                        'uid' => $sourceUid,
                        'calendarId' => $sourceId[0],
                        'notebookCalendarId' => $targetId[0],
                    ]);
                    $collisions++;

                    return;
                }
                if ($sourceUid !== '' && isset($existingUids[$sourceUid])) {
                    throw new RuntimeException(sprintf(
                        'Cannot strip VJOURNAL: uid %s already exists in notebook calendar %s.',
                        $sourceUid,
                        $targetId[0],
                    ));
                }
                $targetUri = $objectUri;
                if (isset($existingUris[$targetUri])) {
                    $base = str_ends_with($objectUri, '.ics') ? substr($objectUri, 0, -4) : $objectUri;
                    $suffix = 2;
                    do {
                        $targetUri = $base.'-moved-'.$suffix.'.ics';
                        $suffix++;
                    } while (isset($existingUris[$targetUri]));
                }
                $existingUris[$targetUri] = true;
                if ($sourceUid !== '') {
                    $existingUids[$sourceUid] = true;
                }
                $data = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $caldav->createCalendarObject($targetId, $targetUri, $data);
                $caldav->deleteCalendarObject($sourceId, $objectUri);
                $moved++;
            });

        return ['moved' => $moved, 'collisions' => $collisions];
    }

    private function ensureNotebookForPrincipal(string $principalUri): string
    {
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));
            $this->collectionsProvisioner->ensureForGroupPrincipal($principalUri, $slug);

            return CalendarCollectionUris::groupNotebookCalDavUri($slug);
        }

        $this->collectionsProvisioner->ensureForPrincipal($principalUri);

        return CalendarCollectionUris::NOTE_GENERAL;
    }
}

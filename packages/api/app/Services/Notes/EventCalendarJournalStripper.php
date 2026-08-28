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
use Illuminate\Support\Facades\Schema;
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

        $ownerInstance = CalendarInstance::query()
            ->where('calendarid', $calendar->id)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->orderBy('id')
            ->first()
            ?? CalendarInstance::query()
                ->where('calendarid', $calendar->id)
                ->orderBy('id')
                ->first();

        $movedObjects = 0;
        if ($ownerInstance !== null) {
            $principalUri = (string) $ownerInstance->principaluri;
            $notebookUri = $this->ensureNotebookForPrincipal($principalUri);

            $notebook = CalendarInstance::query()
                ->where('principaluri', $principalUri)
                ->where('uri', $notebookUri)
                ->first();

            if ($notebook !== null) {
                $movedObjects = $this->moveJournals((int) $calendar->id, $ownerInstance, $notebook);
            }
        }

        $kept = array_values(array_filter(
            array_map('trim', explode(',', (string) $calendar->components)),
            static fn (string $component): bool => $component !== '' && $component !== 'VJOURNAL',
        ));
        $calendar->components = implode(',', $kept);
        $calendar->save();

        return ['stripped' => true, 'movedObjects' => $movedObjects];
    }

    private function moveJournals(int $sourceCalendarId, CalendarInstance $source, CalendarInstance $notebook): int
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $sourceId = [(int) $source->calendarid, (int) $source->id];
        $targetId = [(int) $notebook->calendarid, (int) $notebook->id];
        $existingUris = [];
        CalendarObject::query()
            ->where('calendarid', (int) $notebook->calendarid)
            ->pluck('uri')
            ->each(function (mixed $uri) use (&$existingUris): void {
                $existingUris[(string) $uri] = true;
            });

        $moved = 0;
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
                &$moved,
            ): void {
                $objectUri = (string) $object->uri;
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
                $data = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $caldav->createCalendarObject($targetId, $targetUri, $data);
                $caldav->deleteCalendarObject($sourceId, $objectUri);
                $moved++;
            });

        return $moved;
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

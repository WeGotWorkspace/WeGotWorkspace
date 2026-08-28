<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Moves VTODO objects out of legacy mixed {@see CalendarCollectionUris::EVENT_DEFAULT} calendars
 * into the VTODO-only Inbox collection, then strips VTODO from the default component set.
 */
final class DefaultMixedCalendarMigrator
{
    public function __construct(private readonly InboxTaskListProvisioner $inboxProvisioner) {}

    /**
     * @return array{scanned: int, migrated: int, movedObjects: int, skipped: int}
     */
    public function migrateAllUsers(): array
    {
        if (! Schema::connection('wgw')->hasTable('users') || ! Schema::connection('wgw')->hasTable('calendars')) {
            return ['scanned' => 0, 'migrated' => 0, 'movedObjects' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $migrated = 0;
        $movedObjects = 0;
        $skipped = 0;

        User::query()
            ->orderBy('id')
            ->pluck('username')
            ->each(function (mixed $username) use (&$scanned, &$migrated, &$movedObjects, &$skipped): void {
                $username = strtolower(trim((string) $username));
                if ($username === '') {
                    return;
                }

                $scanned++;
                $result = $this->migratePrincipal('principals/'.$username);
                if ($result['migrated']) {
                    $migrated++;
                    $movedObjects += $result['movedObjects'];
                } else {
                    $skipped++;
                }
            });

        return [
            'scanned' => $scanned,
            'migrated' => $migrated,
            'movedObjects' => $movedObjects,
            'skipped' => $skipped,
        ];
    }

    /**
     * @return array{migrated: bool, movedObjects: int}
     */
    public function migratePrincipal(string $principalUri): array
    {
        $defaultInstance = CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', 'default')
            ->first();

        if ($defaultInstance === null || $defaultInstance->calendar === null || ! $defaultInstance->calendar->isMixed()) {
            return ['migrated' => false, 'movedObjects' => 0];
        }

        $this->inboxProvisioner->ensureForPrincipal($principalUri);

        $inboxInstance = CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', InboxTaskListProvisioner::URI)
            ->first();

        if ($inboxInstance === null) {
            return ['migrated' => false, 'movedObjects' => 0];
        }

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $sourceCalendarId = [(int) $defaultInstance->calendarid, (int) $defaultInstance->id];
        $targetCalendarId = [(int) $inboxInstance->calendarid, (int) $inboxInstance->id];
        $existingInboxUris = $this->existingObjectUris((int) $inboxInstance->calendarid);

        $movedObjects = 0;
        CalendarObject::query()
            ->where('calendarid', (int) $defaultInstance->calendarid)
            ->where('componenttype', 'VTODO')
            ->orderBy('id')
            ->get()
            ->each(function (CalendarObject $object) use (
                $caldav,
                $sourceCalendarId,
                $targetCalendarId,
                &$existingInboxUris,
                &$movedObjects,
            ): void {
                $objectUri = (string) $object->uri;
                $targetUri = $this->allocateTargetUri($objectUri, $existingInboxUris);
                $existingInboxUris[$targetUri] = true;

                $data = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
                $caldav->createCalendarObject($targetCalendarId, $targetUri, $data);
                $caldav->deleteCalendarObject($sourceCalendarId, $objectUri);
                $movedObjects++;
            });

        Calendar::query()
            ->whereKey((int) $defaultInstance->calendarid)
            ->update(['components' => 'VEVENT']);

        return ['migrated' => true, 'movedObjects' => $movedObjects];
    }

    /**
     * @return array<string, true>
     */
    private function existingObjectUris(int $calendarId): array
    {
        $map = [];
        CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->pluck('uri')
            ->each(function (mixed $uri) use (&$map): void {
                $map[(string) $uri] = true;
            });

        return $map;
    }

    /**
     * @param  array<string, true>  $existingUris
     */
    private function allocateTargetUri(string $sourceUri, array $existingUris): string
    {
        if (! array_key_exists($sourceUri, $existingUris)) {
            return $sourceUri;
        }

        $base = str_ends_with($sourceUri, '.ics') ? substr($sourceUri, 0, -4) : $sourceUri;
        $suffix = 2;
        do {
            $candidate = $base.'-migrated-'.$suffix.'.ics';
            $suffix++;
        } while (array_key_exists($candidate, $existingUris));

        return $candidate;
    }
}

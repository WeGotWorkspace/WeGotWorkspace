<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Services\Admin\AdminConstants;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\PropPatch;

/**
 * Assigns distinct palette colors to provisioned calendars that still have the shared default.
 *
 * Leaves collections users already customized away from blank / indigo.
 */
final class DefaultCalendarColorMigrator
{
    /**
     * @return array{scanned: int, updated: int, skipped: int}
     */
    public function migrateAll(): array
    {
        if (! Schema::connection('wgw')->hasTable('calendarinstances')) {
            return ['scanned' => 0, 'updated' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $updated = 0;
        $skipped = 0;
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());

        CalendarInstance::query()
            ->orderBy('id')
            ->each(function (CalendarInstance $instance) use ($caldav, &$scanned, &$updated, &$skipped): void {
                if (! $this->isProvisionedCollection($instance)) {
                    return;
                }

                $scanned++;
                $target = CalendarColorPalette::forUri((string) $instance->uri);
                if (CalendarColorPalette::normalize($instance->calendarcolor) === CalendarColorPalette::normalize($target)) {
                    $skipped++;

                    return;
                }
                if (! CalendarColorPalette::isBlankOrSharedDefault($instance->calendarcolor)) {
                    $skipped++;

                    return;
                }

                $this->writeColor($caldav, $instance, $target);
                $updated++;
            });

        return [
            'scanned' => $scanned,
            'updated' => $updated,
            'skipped' => $skipped,
        ];
    }

    private function isProvisionedCollection(CalendarInstance $instance): bool
    {
        $uri = (string) $instance->uri;
        $principalUri = (string) $instance->principaluri;

        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));
            if ($slug === '') {
                return false;
            }

            return $uri === CalendarCollectionUris::groupCalendarCalDavUri($slug)
                || $uri === CalendarCollectionUris::groupTaskListCalDavUri($slug);
        }

        return CalendarColorPalette::isReservedPersonalUri($uri);
    }

    private function writeColor(CalPDO $caldav, CalendarInstance $instance, string $color): void
    {
        $propPatch = new PropPatch([
            CalendarColorPalette::PROPERTY => $color,
        ]);
        $caldav->updateCalendar([(int) $instance->calendarid, (int) $instance->id], $propPatch);
        $propPatch->commit();
    }
}

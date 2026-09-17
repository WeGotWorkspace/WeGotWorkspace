<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;

/**
 * Provisions default VEVENT calendars and VTODO task lists for users and group principals.
 */
final class UserCalendarCollectionsProvisioner
{
    public function __construct(private readonly InboxTaskListProvisioner $inboxProvisioner) {}

    /**
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllUsers(): array
    {
        if (! Schema::connection('wgw')->hasTable('users') || ! Schema::connection('wgw')->hasTable('calendars')) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        User::query()
            ->orderBy('id')
            ->pluck('username')
            ->each(function (mixed $username) use (&$scanned, &$created, &$skipped): void {
                $username = strtolower(trim((string) $username));
                if ($username === '') {
                    return;
                }

                $scanned++;
                $result = $this->ensureForPrincipal('principals/'.$username);
                $created += $result['created'];
                if ($result['created'] === 0) {
                    $skipped++;
                }
            });

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    /**
     * @return array{created: int}
     */
    public function ensureForPrincipal(string $principalUri): array
    {
        if (! Schema::connection('wgw')->hasTable('calendars')) {
            return ['created' => 0];
        }

        $created = 0;
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $existingUris = $this->calendarUrisForPrincipal($caldav, $principalUri);

        $eventCollections = [
            [CalendarCollectionUris::EVENT_DEFAULT, 'Calendar'],
            [CalendarCollectionUris::EVENT_HOME, 'Home'],
            [CalendarCollectionUris::EVENT_WORK, 'Work'],
        ];

        foreach ($eventCollections as [$uri, $displayName]) {
            if ($this->ensureCalendar($caldav, $principalUri, $uri, $displayName, ['VEVENT'], $existingUris)) {
                $created++;
            }
        }

        if ($this->inboxProvisioner->ensureForPrincipal($principalUri)) {
            $created++;
            $existingUris[InboxTaskListProvisioner::URI] = true;
        } else {
            $existingUris[InboxTaskListProvisioner::URI] = true;
        }

        $taskCollections = [
            [CalendarCollectionUris::TASK_HOME, 'Home'],
            [CalendarCollectionUris::TASK_WORK, 'Work'],
        ];

        foreach ($taskCollections as [$uri, $displayName]) {
            if ($this->ensureCalendar($caldav, $principalUri, $uri, $displayName, ['VTODO'], $existingUris)) {
                $created++;
            }
        }

        if ($this->ensureCalendar(
            $caldav,
            $principalUri,
            CalendarCollectionUris::NOTE_GENERAL,
            'General',
            ['VJOURNAL'],
            $existingUris,
        )) {
            $created++;
        }

        return ['created' => $created];
    }

    /**
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllGroups(): array
    {
        if (! Schema::connection('wgw')->hasTable('principals') || ! Schema::connection('wgw')->hasTable('calendars')) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        Principal::query()
            ->where('uri', 'like', AdminConstants::GROUP_PREFIX.'%')
            ->orderBy('id')
            ->get(['uri', 'displayname'])
            ->each(function (Principal $group) use (&$scanned, &$created, &$skipped): void {
                $scanned++;
                if ($this->ensureForGroupPrincipal((string) $group->uri, (string) ($group->displayname ?? ''))) {
                    $created++;
                } else {
                    $skipped++;
                }
            });

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    public function ensureForGroupPrincipal(string $groupPrincipalUri, string $displayName): bool
    {
        if (! str_starts_with($groupPrincipalUri, AdminConstants::GROUP_PREFIX)) {
            return false;
        }

        $slug = substr($groupPrincipalUri, strlen(AdminConstants::GROUP_PREFIX));
        if ($slug === '') {
            return false;
        }

        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $existingUris = $this->calendarUrisForPrincipal($caldav, $groupPrincipalUri);
        $name = trim($displayName) !== '' ? trim($displayName) : $slug;

        $created = false;
        if ($this->ensureCalendar($caldav, $groupPrincipalUri, $slug, $name, ['VEVENT'], $existingUris)) {
            $created = true;
        }
        if ($this->ensureCalendar(
            $caldav,
            $groupPrincipalUri,
            CalendarCollectionUris::groupTaskListCalDavUri($slug),
            $name,
            ['VTODO'],
            $existingUris,
        )) {
            $created = true;
        }
        if ($this->ensureCalendar(
            $caldav,
            $groupPrincipalUri,
            CalendarCollectionUris::groupNotebookCalDavUri($slug),
            $name,
            ['VJOURNAL'],
            $existingUris,
        )) {
            $created = true;
        }

        return $created;
    }

    /**
     * @param  list<string>  $components
     * @param  array<string, true>  $existingUris
     */
    private function ensureCalendar(
        CalPDO $caldav,
        string $principalUri,
        string $uri,
        string $displayName,
        array $components,
        array &$existingUris,
    ): bool {
        if (array_key_exists($uri, $existingUris)) {
            return false;
        }

        $caldav->createCalendar($principalUri, $uri, [
            '{DAV:}displayname' => $displayName,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet($components),
            CalendarColorPalette::PROPERTY => CalendarColorPalette::forUri($uri),
        ]);
        $existingUris[$uri] = true;

        return true;
    }

    /**
     * @return array<string, true>
     */
    private function calendarUrisForPrincipal(CalPDO $caldav, string $principalUri): array
    {
        $map = [];
        foreach ($caldav->getCalendarsForUser($principalUri) as $calendar) {
            $uri = (string) ($calendar['uri'] ?? '');
            if ($uri !== '') {
                $map[$uri] = true;
            }
        }

        return $map;
    }
}

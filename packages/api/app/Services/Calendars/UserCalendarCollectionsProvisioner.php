<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\CalendarCollectionMeta;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Models\User;
use App\Services\Admin\AdminConstants;
use App\Services\Tasks\InboxTaskListProvisioner;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Provisions default VEVENT calendars and VTODO task lists for users and group principals.
 */
final class UserCalendarCollectionsProvisioner
{
    /** Name of the one task list and notebook a new individual starts with. */
    public const PERSONAL_DISPLAY_NAME = 'Personal';

    public function __construct(
        private readonly InboxTaskListProvisioner $inboxProvisioner,
        private readonly WgwCalendarBackendFactory $backends,
    ) {}

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
        $calendars = $caldav->getCalendarsForUser($principalUri);
        $existingUris = $this->urisOf($calendars);

        $eventCollections = [
            [CalendarCollectionUris::EVENT_DEFAULT, 'Calendar'],
            [CalendarCollectionUris::EVENT_HOME, 'Home'],
            [CalendarCollectionUris::EVENT_WORK, 'Work'],
        ];

        foreach ($eventCollections as [$uri, $displayName]) {
            if ($this->ensureCalendar(CollectionKind::EventCalendar, $principalUri, $uri, $displayName, ['VEVENT'], $existingUris)) {
                $created++;
            }
        }

        // An individual starts with one task list and one notebook, both named "Personal"
        // (#2349). They are the undeletable Inbox and General collections under their old
        // uris, so DAV clients, ICS import and the journal mover keep working. A principal
        // that already owns a collection of the kind keeps its names: nothing is renamed and
        // no second "Personal" appears next to Home, Work or General. Home and Work task
        // lists are no longer created for anyone.
        $ownsTaskList = $this->ownsCollectionOf($calendars, 'VTODO');
        $ownsNotebook = $this->ownsCollectionOf($calendars, 'VJOURNAL');

        if ($this->inboxProvisioner->ensureForPrincipal(
            $principalUri,
            $ownsTaskList ? InboxTaskListProvisioner::DISPLAY_NAME : self::PERSONAL_DISPLAY_NAME,
        )) {
            $created++;
        }
        $existingUris[InboxTaskListProvisioner::URI] = true;

        if ($this->ensureCalendar(
            CollectionKind::Notebook,
            $principalUri,
            CalendarCollectionUris::NOTE_GENERAL,
            $ownsNotebook ? 'General' : self::PERSONAL_DISPLAY_NAME,
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
        return $this->ensureForGroupPrincipals([$groupPrincipalUri => $displayName]) !== [];
    }

    /**
     * {@see ensureForGroupPrincipal()} for several Teams, with one read of the collections they
     * already have: the JMAP push check asks this for every Team of the user on each request (#2243).
     *
     * @param  array<string, string>  $displayNameByGroupUri  Team principal uri => display name
     * @return list<string> the Team principal uris that got a collection
     */
    public function ensureForGroupPrincipals(array $displayNameByGroupUri): array
    {
        $slugByUri = [];
        foreach ($displayNameByGroupUri as $groupPrincipalUri => $displayName) {
            $groupPrincipalUri = (string) $groupPrincipalUri;
            if (! str_starts_with($groupPrincipalUri, AdminConstants::GROUP_PREFIX)) {
                continue;
            }
            $slug = substr($groupPrincipalUri, strlen(AdminConstants::GROUP_PREFIX));
            if ($slug !== '') {
                $slugByUri[$groupPrincipalUri] = $slug;
            }
        }
        if ($slugByUri === []) {
            return [];
        }

        $existingByPrincipal = $this->calendarUrisForPrincipals(array_keys($slugByUri));
        $provisioned = [];
        foreach ($slugByUri as $groupPrincipalUri => $slug) {
            $existingUris = $existingByPrincipal[strtolower($groupPrincipalUri)] ?? [];
            $displayName = (string) $displayNameByGroupUri[$groupPrincipalUri];
            $name = trim($displayName) !== '' ? trim($displayName) : $slug;
            $created = false;
            foreach ([
                [CollectionKind::EventCalendar, $slug, ['VEVENT']],
                [CollectionKind::TaskList, CalendarCollectionUris::groupTaskListCalDavUri($slug), ['VTODO']],
                [CollectionKind::Notebook, CalendarCollectionUris::groupNotebookCalDavUri($slug), ['VJOURNAL']],
            ] as [$kind, $uri, $components]) {
                if ($this->ensureCalendar($kind, $groupPrincipalUri, $uri, $name, $components, $existingUris)) {
                    $created = true;
                }
            }
            if ($created) {
                $provisioned[] = $groupPrincipalUri;
            }
        }

        return $provisioned;
    }

    /**
     * @param  list<string>  $components
     * @param  array<string, true>  $existingUris
     */
    private function ensureCalendar(
        CollectionKind $kind,
        string $principalUri,
        string $uri,
        string $displayName,
        array $components,
        array &$existingUris,
    ): bool {
        if (array_key_exists($uri, $existingUris)) {
            return false;
        }

        $this->backends->make()->createCollection($kind, $principalUri, $uri, [
            '{DAV:}displayname' => $displayName,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet($components),
            CalendarColorPalette::PROPERTY => CalendarColorPalette::forUri($uri),
        ]);
        $existingUris[$uri] = true;

        return true;
    }

    /**
     * @param  array<int, array<string, mixed>>  $calendars  rows of Sabre getCalendarsForUser()
     * @return array<string, true>
     */
    private function urisOf(array $calendars): array
    {
        $map = [];
        foreach ($calendars as $calendar) {
            $uri = (string) ($calendar['uri'] ?? '');
            if ($uri !== '') {
                $map[$uri] = true;
            }
        }

        return $map;
    }

    /**
     * True when the principal owns (is not just a sharee of) a collection whose component
     * set is exactly the one given: a task list is VTODO only, a notebook VJOURNAL only.
     * Chat channels, DMs and thread pools are VJOURNAL only too but are not notebooks, so
     * collections of a DAV-hidden kind never count. A row with no kind still counts.
     *
     * @param  array<int, array<string, mixed>>  $calendars  rows of Sabre getCalendarsForUser()
     */
    private function ownsCollectionOf(array $calendars, string $component): bool
    {
        $ids = [];
        foreach ($calendars as $calendar) {
            $id = $calendar['id'] ?? null;
            $ids[] = is_array($id) ? (int) ($id[0] ?? 0) : (int) $id;
        }
        $hidden = [];
        if ($ids !== []) {
            foreach (CalendarCollectionMeta::query()
                ->whereIn('calendarid', $ids)
                ->get(['calendarid', 'kind']) as $row) {
                if (CollectionKind::tryFrom((string) $row->kind)?->davHidden() === true) {
                    $hidden[(int) $row->calendarid] = true;
                }
            }
        }

        foreach ($calendars as $calendar) {
            if ((int) ($calendar['share-access'] ?? SharingPlugin::ACCESS_NOTSHARED) > SharingPlugin::ACCESS_SHAREDOWNER) {
                continue;
            }
            $id = $calendar['id'] ?? null;
            if (isset($hidden[is_array($id) ? (int) ($id[0] ?? 0) : (int) $id])) {
                continue;
            }
            $set = $calendar['{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'] ?? null;
            if ($set instanceof SupportedCalendarComponentSet && $set->getValue() === [$component]) {
                return true;
            }
        }

        return false;
    }

    /**
     * The collection uris each principal holds, the same rows Sabre's getCalendarsForUser()
     * lists, in one query for all of them.
     *
     * @param  list<string>  $principalUris
     * @return array<string, array<string, true>> keyed by the lower-cased principal uri
     */
    private function calendarUrisForPrincipals(array $principalUris): array
    {
        $map = [];
        foreach (CalendarInstance::query()
            ->whereIn('principaluri', $principalUris)
            ->get(['principaluri', 'uri']) as $instance) {
            $uri = (string) $instance->uri;
            if ($uri !== '') {
                // Keyed in lower case: MySQL compares principal uris without case, as getCalendarsForUser() did.
                $map[strtolower((string) $instance->principaluri)][$uri] = true;
            }
        }

        return $map;
    }
}

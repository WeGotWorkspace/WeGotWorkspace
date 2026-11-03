<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarShareVisibility;
use App\Services\Calendars\CollectionKind;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Docs\DocsThreadCollectionUris;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\DAV\Exception\Conflict;
use Sabre\DAV\Exception\Forbidden;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;
use Sabre\VObject\Recur\MaxInstancesExceededException;

/**
 * The single CalDAV backend for collection lifecycle.
 *
 * Collection ownership is stored per calendarid in `calendar_collection_meta`
 * (see CollectionKind), written here in the same transaction as the collection
 * itself. Internal callers state their kind through createCollection(). The
 * DAV path (MKCALENDAR) states none, so createCalendar() derives it from the
 * component set — the only derivation left in the system.
 *
 * Kinds marked davHidden() never surface over WebDAV. Filtering
 * getCalendarsForUser removes them from calendar-home-set enumeration AND from
 * direct access: Sabre's CalendarHome resolves children through this same
 * method, so PROPFIND/GET/PUT/REPORT on a known hidden URL (ICSExportPlugin
 * included) end in 404 without extra plumbing. Chat channels and docs threads
 * are API-only surfaces whose VJOURNAL payload bends the spec (X-WGW-AUTHOR,
 * reactions, tombstones) and would render as broken journal entries in an
 * external client. Notes stay DAV-visible by design — a note is semantically a
 * real journal entry and external rendering is coherent, tolerated interop.
 *
 * Inbound shares the user dismissed are dropped the same way, so a dismissed
 * share is gone over DAV as it is over REST and JMAP until it is restored.
 *
 * RESERVED_URI_PREFIXES is a separate concern from hiding: it stops a DAV
 * client minting a shadow collection at a uri REST would misread.
 */
final class WgwCalendarBackend extends CalPDO
{
    /** @var list<string> */
    private const RESERVED_URI_PREFIXES = [
        ChatCollectionUris::PREFIX_CHANNEL,
        ChatCollectionUris::PREFIX_DM,
        DocsThreadCollectionUris::POOL_URI,
    ];

    /** DAV property => calendarinstances column a sharee copy follows. */
    private const APPEARANCE_FIELDS = [
        '{DAV:}displayname' => 'displayname',
        '{http://apple.com/ns/ical/}calendar-color' => 'calendarcolor',
    ];

    public function __construct(\PDO $pdo)
    {
        parent::__construct($pdo);
    }

    /**
     * Create a collection and record which app owns it, atomically.
     * Every internal caller uses this; none call createCalendar directly.
     *
     * @param  array<string, mixed>  $properties
     */
    public function createCollection(
        CollectionKind $kind,
        string $principalUri,
        string $calendarUri,
        array $properties,
    ): void {
        $this->assertUriAllowedForKind($kind, $calendarUri);
        $this->persistCollection($kind, $principalUri, $calendarUri, $properties);
    }

    /**
     * Insert the collection and its kind in one transaction.
     *
     * @param  array<string, mixed>  $properties
     * @return string Sabre's calendar id (the parent docblock type; the value is the id pair)
     */
    private function persistCollection(
        CollectionKind $kind,
        string $principalUri,
        string $calendarUri,
        array $properties,
    ) {
        return DB::connection('wgw')->transaction(function () use ($kind, $principalUri, $calendarUri, $properties) {
            $createdId = $this->createCalendarUnguarded($principalUri, $calendarUri, $properties);

            $connection = DB::connection('wgw');
            $calendarId = $connection->table('calendarinstances')
                ->where('principaluri', $principalUri)
                ->where('uri', $calendarUri)
                ->value('calendarid');
            if ($calendarId === null) {
                throw new \RuntimeException('Collection '.$calendarUri.' was not created for '.$principalUri.'.');
            }

            $components = (string) ($connection->table('calendars')->where('id', (int) $calendarId)->value('components') ?? '');
            if (! $kind->allowsComponents($components)) {
                throw new \InvalidArgumentException(
                    'Collection kind '.$kind->value.' cannot be stored on component set "'.$components.'".'
                );
            }

            $connection->table('calendar_collection_meta')->updateOrInsert(
                ['calendarid' => (int) $calendarId],
                ['kind' => $kind->value],
            );

            return $createdId;
        });
    }

    /**
     * Sharee copies a sharee did not rename or recolour follow the owner, from
     * the API and from a DAV client alike (#1822). Other updates go straight
     * to Sabre.
     *
     * @param  mixed  $calendarId  the [calendarid, instanceid] pair
     */
    public function updateCalendar($calendarId, PropPatch $propPatch): void
    {
        if (! is_array($calendarId) || ! $this->ownerAppearanceChange($calendarId, $propPatch)) {
            parent::updateCalendar($calendarId, $propPatch);

            return;
        }

        $supported = array_keys($this->propertyMap);
        $supported[] = '{'.CalDAVPlugin::NS_CALDAV.'}schedule-calendar-transp';
        // One transaction, so the owner and the sharee copies never disagree
        // after a failed write (a DAV PROPPATCH has no outer transaction).
        $propPatch->handle($supported, fn (array $mutations): bool => DB::connection('wgw')->transaction(function () use ($calendarId, $mutations): bool {
            [$collectionId, $instanceId] = [(int) $calendarId[0], (int) $calendarId[1]];
            $before = (array) DB::connection('wgw')->table('calendarinstances')
                ->where('id', $instanceId)
                ->first(array_values(self::APPEARANCE_FIELDS));

            $own = new PropPatch($mutations);
            parent::updateCalendar($calendarId, $own);
            if (! $own->commit()) {
                return false;
            }
            $this->mirrorAppearanceToSharees($collectionId, $before, $mutations);

            return true;
        }));
    }

    /** @param array<mixed> $calendarId */
    private function ownerAppearanceChange(array $calendarId, PropPatch $propPatch): bool
    {
        if (array_intersect_key($propPatch->getMutations(), self::APPEARANCE_FIELDS) === []) {
            return false;
        }
        $connection = DB::connection('wgw');
        $access = $connection->table('calendarinstances')->where('id', (int) ($calendarId[1] ?? 0))->value('access');
        if ((int) ($access ?? SharingPlugin::ACCESS_SHAREDOWNER) !== SharingPlugin::ACCESS_SHAREDOWNER) {
            return false;
        }
        $kind = $connection->table('calendar_collection_meta')->where('calendarid', (int) ($calendarId[0] ?? 0))->value('kind');

        return CollectionKind::tryFrom((string) $kind)?->shareesFollowOwnerAppearance() === true;
    }

    /**
     * A sharee copy that still holds the owner's previous value never got a
     * value of its own, so it takes the new one. The parent update already
     * moved the shared sync token, so sharees re-list the collection.
     *
     * @param  array<string, mixed>  $before  the owner's columns before the update
     * @param  array<string, mixed>  $mutations
     */
    private function mirrorAppearanceToSharees(int $collectionId, array $before, array $mutations): void
    {
        foreach (self::APPEARANCE_FIELDS as $property => $column) {
            if (! array_key_exists($property, $mutations)) {
                continue;
            }
            $previous = $before[$column] ?? null;
            $query = DB::connection('wgw')->table('calendarinstances')
                ->where('calendarid', $collectionId)
                ->where('access', '!=', SharingPlugin::ACCESS_SHAREDOWNER);
            $previous === null ? $query->whereNull($column) : $query->where($column, $previous);
            $query->update([$column => $mutations[$property]]);
        }
    }

    /** @return array<mixed> */
    public function getCalendarsForUser($principalUri)
    {
        $calendars = parent::getCalendarsForUser($principalUri);
        if ($calendars === []) {
            return [];
        }

        $calendarIds = [];
        foreach ($calendars as $calendar) {
            $id = $calendar['id'] ?? null;
            $calendarIds[] = is_array($id) ? (int) ($id[0] ?? 0) : (int) $id;
        }

        $hidden = [];
        $rows = DB::connection('wgw')->table('calendar_collection_meta')
            ->whereIn('calendarid', $calendarIds)
            ->get(['calendarid', 'kind']);
        foreach ($rows as $row) {
            if (CollectionKind::tryFrom((string) $row->kind)?->davHidden() === true) {
                $hidden[(int) $row->calendarid] = true;
            }
        }

        $dismissed = array_flip($this->dismissedShareCalendarIds($principalUri));

        return array_values(array_filter($calendars, static function (array $calendar) use ($hidden, $dismissed): bool {
            $id = $calendar['id'] ?? null;
            $calendarId = is_array($id) ? (int) ($id[0] ?? 0) : (int) $id;
            $access = (int) ($calendar['share-access'] ?? SharingPlugin::ACCESS_SHAREDOWNER);
            $isSharee = $access === SharingPlugin::ACCESS_READ || $access === SharingPlugin::ACCESS_READWRITE;

            return ! array_key_exists($calendarId, $hidden)
                && ! ($isSharee && array_key_exists($calendarId, $dismissed));
        }));
    }

    /**
     * Dismissals are per user, so only a user's own calendar home has them.
     *
     * @return list<int>
     */
    private function dismissedShareCalendarIds(string $principalUri): array
    {
        if (! str_starts_with($principalUri, 'principals/') || str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return [];
        }

        return (new CalendarShareVisibility)->dismissedCalendarIds(substr($principalUri, strlen('principals/')));
    }

    /**
     * MKCALENDAR. Derives the kind, refuses reserved uri prefixes.
     *
     * @param  array<string, mixed>  $properties
     */
    public function createCalendar($principalUri, $calendarUri, array $properties)
    {
        if ($this->isReservedUri((string) $calendarUri)) {
            throw new Forbidden('This calendar URI prefix is reserved for API-only collections.');
        }

        $requested = $properties['{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set'] ?? null;
        $components = is_object($requested) && method_exists($requested, 'getValue')
            ? implode(',', (array) $requested->getValue())
            : 'VEVENT,VTODO';

        return $this->persistCollection(
            CollectionKind::fromComponents($components),
            (string) $principalUri,
            (string) $calendarUri,
            $properties,
        );
    }

    /**
     * @param  array<string, mixed>  $properties
     * @return string
     */
    private function createCalendarUnguarded(string $principalUri, string $calendarUri, array $properties)
    {
        return parent::createCalendar($principalUri, $calendarUri, $properties);
    }

    private function isReservedUri(string $uri): bool
    {
        foreach (self::RESERVED_URI_PREFIXES as $prefix) {
            if (str_starts_with($uri, $prefix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * chat-, dm-, and docs-threads belong to one kind. Any other kind claiming
     * them would shadow Meet rooms or block the docs thread pool.
     */
    private function assertUriAllowedForKind(CollectionKind $kind, string $uri): void
    {
        $owner = match (true) {
            str_starts_with($uri, ChatCollectionUris::PREFIX_CHANNEL),
            str_starts_with($uri, ChatCollectionUris::PREFIX_DM) => CollectionKind::ChatChannel,
            str_starts_with($uri, DocsThreadCollectionUris::POOL_URI) => CollectionKind::DocsThreadPool,
            default => null,
        };
        if ($owner !== null && $owner !== $kind) {
            throw new Forbidden('This collection URI prefix belongs to '.$owner->value.'.');
        }
    }

    /**
     * @param  mixed  $calendarId
     * @param  string  $objectUri
     * @param  string  $calendarData
     */
    public function createCalendarObject($calendarId, $objectUri, $calendarData)
    {
        $this->assertNoteUidFree($calendarId, $calendarData);

        return parent::createCalendarObject($calendarId, $objectUri, $calendarData);
    }

    /**
     * @param  mixed  $calendarId
     * @param  string  $objectUri
     * @param  string  $calendarData
     */
    public function updateCalendarObject($calendarId, $objectUri, $calendarData)
    {
        $this->assertNoteUidFree($calendarId, $calendarData);

        return parent::updateCalendarObject($calendarId, $objectUri, $calendarData);
    }

    /**
     * A note's UID is its collab room key, and room access means "may read a
     * note with this UID". The schema only keeps a UID unique per notebook, so
     * a note written into another notebook with someone else's UID would let
     * its writer into their room. Keep note UIDs unique across all notebooks
     * on every write path, CalDAV included.
     */
    private function assertNoteUidFree(mixed $calendarId, string $calendarData): void
    {
        $id = is_array($calendarId) ? (int) ($calendarId[0] ?? 0) : (int) $calendarId;
        if (! str_contains($calendarData, 'VJOURNAL') || ! $this->isNotebook($id)) {
            return;
        }
        $data = $this->getDenormalizedData($calendarData);
        if ($data['componentType'] !== 'VJOURNAL' || ($data['uid'] ?? '') === '') {
            return;
        }
        $taken = DB::connection('wgw')->table('calendarobjects')
            ->join('calendar_collection_meta', 'calendar_collection_meta.calendarid', '=', 'calendarobjects.calendarid')
            ->where('calendar_collection_meta.kind', CollectionKind::Notebook->value)
            ->where('calendarobjects.componenttype', 'VJOURNAL')
            ->where('calendarobjects.uid', (string) $data['uid'])
            ->where('calendarobjects.calendarid', '!=', $id)
            ->exists();
        if ($taken) {
            throw new Conflict('A note with this UID already exists.');
        }
    }

    private function isNotebook(int $calendarId): bool
    {
        return DB::connection('wgw')->table('calendar_collection_meta')
            ->where('calendarid', $calendarId)
            ->where('kind', CollectionKind::Notebook->value)
            ->exists();
    }

    /**
     * @param  array<mixed>  $object
     * @param  array<mixed>  $filters
     */
    protected function validateFilterForObject(array $object, array $filters)
    {
        try {
            return parent::validateFilterForObject($object, $filters);
        } catch (MaxInstancesExceededException) {
            Log::warning('caldav.recurrence_cap', ['uri' => $object['uri'] ?? null]);

            return false;
        }
    }
}

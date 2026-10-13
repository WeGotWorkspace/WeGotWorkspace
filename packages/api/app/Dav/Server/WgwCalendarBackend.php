<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\CollectionKind;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Docs\DocsThreadCollectionUris;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\Exception\Forbidden;
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

        return array_values(array_filter($calendars, static function (array $calendar) use ($hidden): bool {
            $id = $calendar['id'] ?? null;
            $calendarId = is_array($id) ? (int) ($id[0] ?? 0) : (int) $id;

            return ! array_key_exists($calendarId, $hidden);
        }));
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

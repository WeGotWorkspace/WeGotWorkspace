<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\Exception\Forbidden;

/**
 * CalDAV PDO backend for the DAV server only: collections whose URI carries a
 * hidden prefix (`chat-`/`dm-` by default, see wgw.chat.dav_hidden_prefixes)
 * never surface over WebDAV.
 *
 * Chat channels are API-only surfaces. Their VJOURNAL payload bends the spec
 * (X-WGW-AUTHOR, reactions, tombstones), so foreign chat messages would render
 * as broken "cancelled journal entries" in an external journal client — and a
 * busy channel would flood an external sync. Filtering getCalendarsForUser
 * removes them from calendar-home-set enumeration AND from direct access:
 * Sabre's CalendarHome resolves children through this same method, so
 * PROPFIND/GET/PUT/REPORT on a known chat URL (ICSExportPlugin included) end
 * in 404 without extra plumbing. createCalendar is refused for hidden prefixes
 * so DAV clients cannot mint shadow collections that REST would misread as
 * channels (precedent for node-level guarding: WebdavWriteGuardPlugin).
 *
 * Notes collections stay DAV-visible by design — a note is semantically a real
 * journal entry and external rendering is coherent, tolerated interop. Only
 * the configured prefixes are hidden. REST/JMAP repositories construct their
 * own stock PDO backends and are unaffected.
 */
final class ChatHiddenCalendarBackend extends CalPDO
{
    /**
     * @param  list<string>  $hiddenUriPrefixes
     */
    public function __construct(\PDO $pdo, private readonly array $hiddenUriPrefixes)
    {
        parent::__construct($pdo);
    }

    public function getCalendarsForUser($principalUri)
    {
        return array_values(array_filter(
            parent::getCalendarsForUser($principalUri),
            fn (array $calendar): bool => ! $this->isHiddenUri((string) ($calendar['uri'] ?? '')),
        ));
    }

    public function createCalendar($principalUri, $calendarUri, array $properties)
    {
        if ($this->isHiddenUri((string) $calendarUri)) {
            throw new Forbidden('This calendar URI prefix is reserved for API-only collections.');
        }

        return parent::createCalendar($principalUri, $calendarUri, $properties);
    }

    private function isHiddenUri(string $uri): bool
    {
        foreach ($this->hiddenUriPrefixes as $prefix) {
            if ($prefix !== '' && str_starts_with($uri, $prefix)) {
                return true;
            }
        }

        return false;
    }
}

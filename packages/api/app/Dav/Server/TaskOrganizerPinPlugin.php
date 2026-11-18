<?php

declare(strict_types=1);

namespace App\Dav\Server;

use Sabre\CalDAV\ICalendarObject;
use Sabre\DAV\INode;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;

/**
 * Keeps the stored ORGANIZER of a task on a CalDAV PUT (#2172).
 *
 * The organizer of a VTODO is fixed once stored (product owner, 2026-11-18):
 * REST and MCP cannot change it, and neither can a CalDAV client. When a PUT
 * replaces a stored VTODO that has an ORGANIZER, the stored line goes back
 * into the incoming component of the same UID and RECURRENCE-ID, whatever the
 * client sent or left out. Everything else in the PUT is stored as sent; a
 * write without a stored organizer passes untouched, so the PUT is never
 * refused. Only VTODOs are touched; events keep their scheduling rules.
 */
final class TaskOrganizerPinPlugin extends ServerPlugin
{
    /** After the CalDAV plugin has validated the body (priority 100). */
    private const PRIORITY = 150;

    public function initialize(Server $server): void
    {
        $server->on('beforeWriteContent', [$this, 'beforeWriteContent'], self::PRIORITY);
    }

    public function getPluginName(): string
    {
        return 'wgw-task-organizer-pin';
    }

    /**
     * @param  string|resource|null  $data
     */
    public function beforeWriteContent(string $path, INode $node, mixed &$data, bool &$modified): void
    {
        if (! $node instanceof ICalendarObject) {
            return;
        }
        $storedRaw = $node->get();
        $storedRaw = is_resource($storedRaw) ? (string) stream_get_contents($storedRaw) : (string) $storedRaw;
        if (stripos($storedRaw, 'ORGANIZER') === false || stripos($storedRaw, 'BEGIN:VTODO') === false) {
            return;
        }
        $organizers = self::storedOrganizers($storedRaw);
        if ($organizers === []) {
            return;
        }

        if (is_resource($data)) {
            $data = (string) stream_get_contents($data);
        }
        $incoming = self::read((string) $data);
        if ($incoming === null) {
            return;
        }

        $changed = false;
        foreach ($incoming->select('VTODO') as $todo) {
            if (! $todo instanceof Component) {
                continue;
            }
            $stored = $organizers[self::key($todo)] ?? null;
            if ($stored === null) {
                continue;
            }
            $current = $todo->select('ORGANIZER')[0] ?? null;
            if ($current instanceof Property && $current->serialize() === $stored->serialize()) {
                continue;
            }
            $todo->remove('ORGANIZER');
            $todo->add(clone $stored);
            $changed = true;
        }

        if ($changed) {
            $data = $incoming->serialize();
            $modified = true;
        }
    }

    /**
     * @return array<string, Property> the ORGANIZER per VTODO key
     */
    private static function storedOrganizers(string $raw): array
    {
        $stored = self::read($raw);
        if ($stored === null) {
            return [];
        }
        $organizers = [];
        foreach ($stored->select('VTODO') as $todo) {
            if (! $todo instanceof Component) {
                continue;
            }
            $organizer = $todo->select('ORGANIZER')[0] ?? null;
            if ($organizer instanceof Property) {
                $organizers[self::key($todo)] = $organizer;
            }
        }

        return $organizers;
    }

    private static function key(Component $todo): string
    {
        $uid = trim((string) ($todo->UID ?? ''));
        $recurrence = isset($todo->{'RECURRENCE-ID'}) ? trim((string) $todo->{'RECURRENCE-ID'}->getValue()) : '';

        return $uid."\n".$recurrence;
    }

    private static function read(string $ics): ?VCalendar
    {
        try {
            $parsed = Reader::read($ics);
        } catch (\Throwable) {
            return null;
        }

        return $parsed instanceof VCalendar ? $parsed : null;
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\Conversion\TimeZoneSupport;
use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;
use Sabre\VObject\Reader;

final class CalendarFeedIcsBuilder
{
    /** @var list<string> */
    private const BUSY_KEEP = [
        'UID',
        'DTSTART',
        'DTEND',
        'DURATION',
        'RRULE',
        'RDATE',
        'EXDATE',
        'RECURRENCE-ID',
        'DTSTAMP',
    ];

    public function build(CalendarInstance $instance, string $mode = 'full'): string
    {
        $out = new VCalendar;
        $out->PRODID = '-//WeGotWorkspace//Calendar//EN';

        $objects = CalendarObject::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('componenttype', 'VEVENT')
            ->orderBy('uri')
            ->get();

        $timezones = [];
        foreach ($objects as $object) {
            $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
            if ($raw === '') {
                continue;
            }
            if (strlen($raw) > VObjectPayloadGuard::MAX_ICS_BYTES) {
                continue;
            }

            try {
                $document = Reader::read($raw);
            } catch (\Throwable) {
                continue;
            }
            if (! $document instanceof VCalendar) {
                continue;
            }

            foreach ($document->select('VTIMEZONE') as $timezone) {
                $tzid = isset($timezone->TZID) ? trim((string) $timezone->TZID->getValue()) : '';
                $key = $tzid !== '' ? $tzid : spl_object_id($timezone);
                if (isset($timezones[$key])) {
                    continue;
                }
                $timezones[$key] = true;
                $out->add(clone $timezone);
            }
            foreach ($document->select('VEVENT') as $vevent) {
                if (! $vevent instanceof VEvent) {
                    continue;
                }
                $copy = clone $vevent;
                $this->redact($copy, $mode === 'busy');
                $out->add($copy);
            }
        }

        TimeZoneSupport::ensureReferencedTimeZones($out);

        return $out->serialize();
    }

    private function redact(VEvent $event, bool $forceBusy): void
    {
        if ($forceBusy || $this->isPrivateOrConfidential($event)) {
            $this->reduceToBusy($event);

            return;
        }

        $this->stripSensitive($event);
    }

    private function isPrivateOrConfidential(VEvent $event): bool
    {
        $class = $event->CLASS;
        if ($class === null) {
            return false;
        }
        $normalized = strtoupper(trim($class->getValue()));

        return $normalized === 'PRIVATE' || $normalized === 'CONFIDENTIAL';
    }

    private function reduceToBusy(VEvent $event): void
    {
        $this->removeChildren($event, function (string $name, Property|Component $child): bool {
            return ! in_array($name, self::BUSY_KEEP, true);
        });
        $event->add('SUMMARY', 'Busy');
        $this->stripVendorParameters($event);
    }

    private function stripSensitive(VEvent $event): void
    {
        $this->removeChildren($event, function (string $name, Property|Component $child): bool {
            if ($name === 'ATTENDEE' || $name === 'ORGANIZER' || $name === 'VALARM' || $name === 'CONFERENCE') {
                return true;
            }
            if (str_starts_with($name, 'X-WGW-')) {
                return true;
            }

            return $name === 'URL' && $child instanceof Property && $this->urlPointsAtMeet($child);
        });
        $this->stripVendorParameters($event);
    }

    /**
     * @param  callable(string, Property|Component): bool  $shouldDrop
     */
    private function removeChildren(VEvent $event, callable $shouldDrop): void
    {
        $drop = [];
        foreach ($event->children() as $child) {
            if (! $child instanceof Property && ! $child instanceof Component) {
                continue;
            }
            if ($shouldDrop(strtoupper($child->name), $child)) {
                $drop[] = $child;
            }
        }
        foreach ($drop as $child) {
            $event->remove($child);
        }
    }

    private function stripVendorParameters(VEvent $event): void
    {
        foreach ($event->children() as $child) {
            if (! $child instanceof Property) {
                continue;
            }
            foreach (array_keys($child->parameters) as $paramName) {
                if (! is_string($paramName) || ! str_starts_with(strtoupper($paramName), 'X-WGW-')) {
                    continue;
                }
                unset($child->parameters[$paramName]);
            }
        }
    }

    private function urlPointsAtMeet(Property $property): bool
    {
        $value = $property->getValue();
        if ($value === '') {
            return false;
        }

        return preg_match('~/meet(?:/|\?|#|$)~i', $value) === 1;
    }
}

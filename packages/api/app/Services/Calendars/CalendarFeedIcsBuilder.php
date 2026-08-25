<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Services\Calendars\Conversion\TimeZoneSupport;
use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

final class CalendarFeedIcsBuilder
{
    public function build(CalendarInstance $instance): string
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
                if ($vevent instanceof VEvent) {
                    $out->add(clone $vevent);
                }
            }
        }

        TimeZoneSupport::ensureReferencedTimeZones($out);

        return $out->serialize();
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use App\Services\VObject\ICalendarDateList;
use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarRecurrence;
use App\Services\VObject\VObjectPayloadGuard;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;

final class JmapEventToVEventConverter
{
    public function __construct(
        private readonly VObjectPayloadGuard $guard = new VObjectPayloadGuard,
    ) {}

    /**
     * @param  array<string, mixed>  $event
     */
    public function convert(array $event): string
    {
        $ics = $this->buildCalendar($event)->serialize();
        $this->guard->assertIcsSize($ics);

        return $ics;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public function updateVEventInIcs(string $ics, array $event, string $targetUid): string
    {
        $document = $this->guard->readICalendar($ics);

        $replaced = false;
        foreach (CalendarConversionSupport::veventsFromCalendar($document) as $vevent) {
            $uid = isset($vevent->UID) ? trim((string) $vevent->UID->getValue()) : '';
            if ($uid === $targetUid) {
                $document->remove($vevent);
                $replaced = true;
            }
        }

        if (! $replaced) {
            throw new \InvalidArgumentException('VEVENT with UID '.$targetUid.' not found.');
        }

        $event['uid'] = $targetUid;
        $this->appendSeriesVevents($document, $event);

        $updated = $document->serialize();
        $this->guard->assertIcsSize($updated);

        return $updated;
    }

    public function removeVEventFromIcs(string $ics, string $targetUid): ?string
    {
        $document = $this->guard->readICalendar($ics);

        $removed = false;
        foreach (CalendarConversionSupport::veventsFromCalendar($document) as $vevent) {
            $uid = isset($vevent->UID) ? trim((string) $vevent->UID->getValue()) : '';
            if ($uid === $targetUid) {
                $document->remove($vevent);
                $removed = true;
            }
        }

        if (! $removed) {
            throw new \InvalidArgumentException('VEVENT with UID '.$targetUid.' not found.');
        }

        if (CalendarConversionSupport::veventsFromCalendar($document) === []) {
            return null;
        }

        $updated = $document->serialize();
        $this->guard->assertIcsSize($updated);

        return $updated;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function buildCalendar(array $event): VCalendar
    {
        $calendar = new VCalendar([], false);
        $calendar->add('VERSION', '2.0');
        $calendar->add('PRODID', '-//WeGotWorkspace//Calendars REST//EN');
        TimeZoneSupport::writeTimeZonesToCalendar($calendar, $event);
        $this->appendSeriesVevents($calendar, $event);

        return $calendar;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function appendSeriesVevents(VCalendar $calendar, array $event): void
    {
        $this->populateVEvent($calendar->add('VEVENT', []), $event);
        $this->appendOverrideVevents($calendar, $event);
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function appendOverrideVevents(VCalendar $calendar, array $event): void
    {
        $overrides = $event['recurrenceOverrides'] ?? null;
        if (! is_array($overrides) || $overrides === []) {
            return;
        }

        $masterEvent = CalendarConversionSupport::normalizeEventMapKeys($event);
        $rdateValues = [];
        foreach ($overrides as $recurrenceIdKey => $patch) {
            if (! is_string($recurrenceIdKey) || $recurrenceIdKey === '' || ! is_array($patch)) {
                continue;
            }

            if (self::isRdateOnlyOverride($patch)) {
                $rdateValues[] = ICalendarDateTime::toIcs($recurrenceIdKey);

                continue;
            }

            $overrideVevent = $calendar->add('VEVENT', []);
            if (RecurrenceOverrideSupport::isExcludedOverride($patch)) {
                RecurrenceOverrideSupport::populateExcludedOverrideVEvent(
                    $overrideVevent,
                    $masterEvent,
                    $recurrenceIdKey,
                );

                continue;
            }

            $merged = CalendarConversionSupport::deepMergeEventPatch($masterEvent, $patch);
            $merged['uid'] = $masterEvent['uid'];
            $this->populateVEvent($overrideVevent, $merged);
            $this->stripMasterOnlyProperties($overrideVevent);
            RecurrenceOverrideSupport::writeRecurrenceIdProperty(
                $overrideVevent,
                $recurrenceIdKey,
                $masterEvent,
            );
            if (! isset($patch['start'])) {
                if (isset($overrideVevent->DTSTART)) {
                    $overrideVevent->remove('DTSTART');
                }
                ICalendarDateTime::writeProperty(
                    $overrideVevent,
                    'DTSTART',
                    $recurrenceIdKey,
                    (bool) ($masterEvent['showWithoutTime'] ?? false),
                    isset($masterEvent['timeZone']) && is_string($masterEvent['timeZone']) ? $masterEvent['timeZone'] : null,
                );
            }
        }

        if ($rdateValues !== []) {
            $masterVevent = CalendarConversionSupport::primaryVEvent($calendar);
            if ($masterVevent !== null) {
                $masterVevent->add('RDATE', implode(',', $rdateValues));
            }
        }
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private static function isRdateOnlyOverride(array $patch): bool
    {
        if (RecurrenceOverrideSupport::isExcludedOverride($patch)) {
            return false;
        }

        foreach ($patch as $key => $value) {
            if ($key === '@type') {
                continue;
            }

            return false;
        }

        return true;
    }

    private function stripMasterOnlyProperties(VEvent $vevent): void
    {
        foreach (['RRULE', 'EXDATE', 'RDATE'] as $name) {
            if (isset($vevent->{$name})) {
                $vevent->remove($name);
            }
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function populateVEvent(VEvent $vevent, array $event): void
    {
        $event = CalendarConversionSupport::normalizeEventMapKeys($event);
        if (isset($vevent->UID)) {
            $vevent->UID->setValue((string) $event['uid']);
        } else {
            $vevent->add('UID', (string) $event['uid']);
        }

        if (isset($event['title']) && is_string($event['title'])) {
            $vevent->add('SUMMARY', $event['title']);
        }

        if (isset($event['description']) && is_string($event['description']) && $event['description'] !== '') {
            $vevent->add('DESCRIPTION', $event['description']);
        }

        $showWithoutTime = (bool) ($event['showWithoutTime'] ?? false);
        $timeZone = isset($event['timeZone']) && is_string($event['timeZone']) ? $event['timeZone'] : null;

        if (isset($event['start'])) {
            ICalendarDateTime::writeProperty(
                $vevent,
                'DTSTART',
                $event['start'],
                $showWithoutTime,
                $timeZone
            );
        }

        if (isset($event['end'])) {
            ICalendarDateTime::writeProperty(
                $vevent,
                'DTEND',
                $event['end'],
                $showWithoutTime,
                $timeZone
            );
        } elseif (isset($event['duration']) && is_string($event['duration'])) {
            $vevent->add('DURATION', $event['duration']);
        }

        if (isset($event['recurrenceRules']) && is_array($event['recurrenceRules'])) {
            foreach ($event['recurrenceRules'] as $rule) {
                if (is_array($rule)) {
                    $vevent->add('RRULE', ICalendarRecurrence::ruleToIcs($rule));
                }
            }
        }

        if (isset($event['excludedRecurrenceRules']) && is_array($event['excludedRecurrenceRules'])) {
            foreach ($event['excludedRecurrenceRules'] as $rule) {
                if (is_array($rule)) {
                    $vevent->add('EXRULE', ICalendarRecurrence::ruleToIcs($rule));
                }
            }
        }

        if (isset($event['excludedRecurrenceDates']) && is_array($event['excludedRecurrenceDates']) && $event['excludedRecurrenceDates'] !== []) {
            $values = ICalendarDateList::toIcsValues($event['excludedRecurrenceDates']);
            if ($values !== []) {
                $vevent->add('EXDATE', implode(',', $values));
            }
        }

        LocationConversionSupport::writeLocationsAndLinks($vevent, $event);
        $this->writeStatusAndPrivacy($vevent, $event);
        $this->writeTimestamps($vevent, $event);
        ParticipantConversionSupport::writeParticipants($vevent, $event);
        $this->writeAlerts($vevent, $event);
        $this->writeIcsProps($vevent, $event);

        $now = gmdate('Ymd\THis\Z');
        if (! isset($vevent->DTSTAMP)) {
            $vevent->add('DTSTAMP', $now);
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function writeStatusAndPrivacy(VEvent $vevent, array $event): void
    {
        if (isset($event['status']) && is_string($event['status'])) {
            $vevent->add('STATUS', strtoupper($event['status']));
        }

        if (isset($event['freeBusyStatus']) && is_string($event['freeBusyStatus'])) {
            if ($event['freeBusyStatus'] === 'free') {
                $vevent->add('TRANSP', 'TRANSPARENT');
            } elseif ($event['freeBusyStatus'] === 'tentative') {
                $vevent->add('TRANSP', 'OPAQUE');
                if (! isset($event['status'])) {
                    $vevent->add('STATUS', 'TENTATIVE');
                }
            } else {
                $vevent->add('TRANSP', 'OPAQUE');
            }
        }

        if (isset($event['privacy']) && is_string($event['privacy'])) {
            $class = $event['privacy'] === 'secret' ? 'CONFIDENTIAL' : strtoupper($event['privacy']);
            $vevent->add('CLASS', $class);
        }

        if (isset($event['sequence'])) {
            $vevent->add('SEQUENCE', (string) (int) $event['sequence']);
        }

        if (isset($event['priority'])) {
            $vevent->add('PRIORITY', (string) (int) $event['priority']);
        }

        if (isset($event['categories']) && is_array($event['categories']) && $event['categories'] !== []) {
            $vevent->add('CATEGORIES', implode(',', array_map('strval', $event['categories'])));
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function writeTimestamps(VEvent $vevent, array $event): void
    {
        if (isset($event['created']) && is_string($event['created'])) {
            $vevent->add('CREATED', ICalendarDateTime::toIcs($event['created']));
        }

        if (isset($event['updated']) && is_string($event['updated'])) {
            $vevent->add('LAST-MODIFIED', ICalendarDateTime::toIcs($event['updated']));
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function writeAlerts(VEvent $vevent, array $event): void
    {
        $alerts = $event['alerts'] ?? null;
        if (! is_array($alerts)) {
            return;
        }

        $title = isset($event['title']) && is_string($event['title']) ? $event['title'] : null;
        foreach ($alerts as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            CalendarConversionSupport::writeValarm($vevent, $entry, $title);
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function writeIcsProps(VEvent $vevent, array $event): void
    {
        $props = $event['icsProps'] ?? null;
        if (! is_array($props)) {
            return;
        }

        foreach ($props as $name => $value) {
            if (! is_string($name) || ! is_string($value) || trim($value) === '') {
                continue;
            }
            $vevent->add(strtoupper($name), $value);
        }
    }
}

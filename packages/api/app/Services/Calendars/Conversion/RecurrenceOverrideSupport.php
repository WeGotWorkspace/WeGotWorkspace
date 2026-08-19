<?php

declare(strict_types=1);

namespace App\Services\Calendars\Conversion;

use App\Services\VObject\ICalendarDateTime;
use App\Services\VObject\ICalendarSeries;
use App\Services\VObject\ICalendarUid;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;

/**
 * RECURRENCE-ID override VEVENTs ↔ JMAP recurrenceOverrides.
 *
 * Override components share the master UID and are keyed by RECURRENCE-ID
 * (the original instance start). Compatible with Sabre\EventIterator input shape
 * (array of VEVENTs with matching UID) for future expandRecurrences (#159).
 */
final class RecurrenceOverrideSupport
{
    /**
     * @param  list<VEvent>  $vevents
     * @return list<array{master: VEvent, overrides: list<VEvent>}>
     */
    public static function groupRecurrenceSeries(array $vevents): array
    {
        $series = [];
        foreach (ICalendarSeries::groupByUid(
            $vevents,
            static fn (VEvent $vevent): string => ICalendarUid::fromSeed((string) $vevent->serialize()),
        ) as $group) {
            ['masters' => $masters, 'overrides' => $overrides] = ICalendarSeries::partitionMastersAndOverrides($group);

            if ($masters === [] && $overrides !== []) {
                foreach ($overrides as $override) {
                    if ($override instanceof VEvent) {
                        $series[] = ['master' => $override, 'overrides' => []];
                    }
                }

                continue;
            }

            $eventOverrides = array_values(array_filter(
                $overrides,
                static fn (mixed $component): bool => $component instanceof VEvent,
            ));
            foreach ($masters as $master) {
                if ($master instanceof VEvent) {
                    $series[] = ['master' => $master, 'overrides' => $eventOverrides];
                }
            }
        }

        return $series;
    }

    /**
     * @return list<VEvent>
     */
    public static function veventsForEventIterator(VCalendar $calendar, string $uid): array
    {
        $vevents = [];
        foreach (CalendarConversionSupport::veventsFromCalendar($calendar) as $vevent) {
            $eventUid = isset($vevent->UID) ? trim((string) $vevent->UID->getValue()) : '';
            if ($eventUid === $uid) {
                $vevents[] = $vevent;
            }
        }

        return $vevents;
    }

    /**
     * @param  list<VEvent>  $overrides
     * @return array<string, array<string, mixed>>
     */
    public static function recurrenceOverridesFromVevents(VEvent $master, array $overrides): array
    {
        $result = [];
        foreach ($overrides as $override) {
            if (! isset($override->{'RECURRENCE-ID'})) {
                continue;
            }
            $key = self::recurrenceIdKeyFromProperty($override->{'RECURRENCE-ID'});
            if ($key === '') {
                continue;
            }
            $patch = self::overridePatchFromVEvent($master, $override);
            if ($patch !== []) {
                $result[$key] = $patch;
            }
        }

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public static function overridePatchFromVEvent(VEvent $master, VEvent $override): array
    {
        if (isset($override->STATUS) && strtoupper(trim((string) $override->STATUS->getValue())) === 'CANCELLED') {
            return ['excluded' => true];
        }

        $patch = [];

        if (isset($override->SUMMARY)) {
            $overrideTitle = trim((string) $override->SUMMARY->getValue());
            $masterTitle = isset($master->SUMMARY) ? trim((string) $master->SUMMARY->getValue()) : '';
            if ($overrideTitle !== '' && $overrideTitle !== $masterTitle) {
                $patch['title'] = $overrideTitle;
            }
        }

        if (isset($override->DESCRIPTION)) {
            $overrideDescription = trim((string) $override->DESCRIPTION->getValue());
            $masterDescription = isset($master->DESCRIPTION) ? trim((string) $master->DESCRIPTION->getValue()) : '';
            if ($overrideDescription !== $masterDescription) {
                $patch['description'] = $overrideDescription !== '' ? $overrideDescription : null;
            }
        }

        if (isset($override->DTSTART)) {
            $overrideStart = ICalendarDateTime::fromProperty($override->DTSTART);
            $masterStart = isset($master->DTSTART)
                ? ICalendarDateTime::fromProperty($master->DTSTART)
                : null;
            if ($masterStart === null || $overrideStart['value'] !== $masterStart['value']) {
                $patch['start'] = $overrideStart['value'];
                if ($overrideStart['showWithoutTime']) {
                    $patch['showWithoutTime'] = true;
                }
            }
            if ($overrideStart['timeZone'] !== null
                && $overrideStart['timeZone'] !== ($masterStart['timeZone'] ?? null)) {
                $patch['timeZone'] = $overrideStart['timeZone'];
            }
        }

        if (isset($override->DTEND)) {
            $overrideEnd = ICalendarDateTime::fromProperty($override->DTEND);
            $masterEnd = isset($master->DTEND)
                ? ICalendarDateTime::fromProperty($master->DTEND)
                : null;
            if ($masterEnd === null || $overrideEnd['value'] !== $masterEnd['value']) {
                $patch['end'] = $overrideEnd['value'];
                $overrideStartValue = isset($override->DTSTART)
                    ? ICalendarDateTime::fromProperty($override->DTSTART)['value']
                    : (isset($master->DTSTART)
                        ? ICalendarDateTime::fromProperty($master->DTSTART)['value']
                        : null);
                if (is_string($overrideStartValue)) {
                    $overrideDuration = CalendarConversionSupport::durationBetweenJmapDateTimes(
                        $overrideStartValue,
                        $overrideEnd['value'],
                    );
                    if ($overrideDuration !== null) {
                        $patch['duration'] = $overrideDuration;
                    }
                }
            }
        } elseif (isset($override->DURATION)) {
            $overrideDuration = trim((string) $override->DURATION->getValue());
            $masterDuration = isset($master->DURATION) ? trim((string) $master->DURATION->getValue()) : '';
            if ($overrideDuration !== '' && $overrideDuration !== $masterDuration) {
                $patch['duration'] = $overrideDuration;
            }
        }

        if (isset($override->LOCATION)) {
            $overrideLocation = trim((string) $override->LOCATION->getValue());
            $masterLocation = isset($master->LOCATION) ? trim((string) $master->LOCATION->getValue()) : '';
            if ($overrideLocation !== $masterLocation && $overrideLocation !== '') {
                $patch['locations'] = [
                    'loc1' => [
                        '@type' => 'Location',
                        'name' => $overrideLocation,
                    ],
                ];
            }
        }

        if (isset($override->STATUS)) {
            $status = strtolower(trim((string) $override->STATUS->getValue()));
            if (in_array($status, ['confirmed', 'cancelled', 'tentative'], true)) {
                $masterStatus = isset($master->STATUS)
                    ? strtolower(trim((string) $master->STATUS->getValue()))
                    : null;
                if ($status !== $masterStatus) {
                    $patch['status'] = $status;
                }
            }
        }

        if (isset($override->TRANSP)) {
            $transp = strtolower(trim((string) $override->TRANSP->getValue()));
            $overrideFreeBusy = $transp === 'transparent' ? 'free' : 'busy';
            $masterFreeBusy = isset($master->TRANSP)
                ? (strtolower(trim((string) $master->TRANSP->getValue())) === 'transparent' ? 'free' : 'busy')
                : null;
            if ($overrideFreeBusy !== $masterFreeBusy) {
                $patch['freeBusyStatus'] = $overrideFreeBusy;
            }
        }

        if (isset($override->CLASS)) {
            $class = strtolower(trim((string) $override->CLASS->getValue()));
            if (in_array($class, ['public', 'private', 'confidential'], true)) {
                $overridePrivacy = $class === 'confidential' ? 'secret' : $class;
                $masterPrivacy = isset($master->CLASS)
                    ? ((strtolower(trim((string) $master->CLASS->getValue())) === 'confidential') ? 'secret' : strtolower(trim((string) $master->CLASS->getValue())))
                    : null;
                if ($overridePrivacy !== $masterPrivacy) {
                    $patch['privacy'] = $overridePrivacy;
                }
            }
        }

        $participants = self::participantOverridePatch($master, $override);
        if ($participants !== null) {
            $patch['participants'] = $participants;
        }

        return $patch;
    }

    /**
     * @return array<string, mixed>|null
     */
    private static function participantOverridePatch(VEvent $master, VEvent $override): ?array
    {
        $masterEvent = [];
        ParticipantConversionSupport::readParticipants($master, $masterEvent);
        $overrideEvent = [];
        ParticipantConversionSupport::readParticipants($override, $overrideEvent);
        $masterParticipants = is_array($masterEvent['participants'] ?? null) ? $masterEvent['participants'] : [];
        $overrideParticipants = is_array($overrideEvent['participants'] ?? null) ? $overrideEvent['participants'] : [];
        if ($overrideParticipants === []) {
            return null;
        }

        $masterByEmail = [];
        foreach ($masterParticipants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = strtolower(trim((string) ($entry['email'] ?? '')));
            if ($email !== '') {
                $masterByEmail[$email] = $entry;
            }
        }

        $changed = false;
        foreach ($overrideParticipants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = strtolower(trim((string) ($entry['email'] ?? '')));
            if ($email === '') {
                continue;
            }
            $masterStatus = strtolower((string) ($masterByEmail[$email]['participationStatus'] ?? ''));
            $overrideStatus = strtolower((string) ($entry['participationStatus'] ?? ''));
            if ($overrideStatus !== $masterStatus) {
                $changed = true;
                break;
            }
        }

        return $changed ? $overrideParticipants : null;
    }

    public static function recurrenceIdKeyFromProperty(Property $property): string
    {
        return ICalendarDateTime::fromProperty($property)['value'];
    }

    /**
     * @param  array<string, mixed>  $masterEvent
     */
    public static function writeRecurrenceIdProperty(VEvent $vevent, string $recurrenceIdKey, array $masterEvent): void
    {
        if (isset($vevent->{'RECURRENCE-ID'})) {
            $vevent->remove('RECURRENCE-ID');
        }

        ICalendarDateTime::writeProperty(
            $vevent,
            'RECURRENCE-ID',
            $recurrenceIdKey,
            (bool) ($masterEvent['showWithoutTime'] ?? false),
            isset($masterEvent['timeZone']) && is_string($masterEvent['timeZone']) ? $masterEvent['timeZone'] : null,
        );
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    public static function isExcludedOverride(array $patch): bool
    {
        return ($patch['excluded'] ?? false) === true;
    }

    /**
     * @param  array<string, mixed>  $masterEvent
     */
    public static function populateExcludedOverrideVEvent(VEvent $vevent, array $masterEvent, string $recurrenceIdKey): void
    {
        $uid = (string) ($masterEvent['uid'] ?? ICalendarUid::fromSeed($recurrenceIdKey));
        if (isset($vevent->UID)) {
            $vevent->UID->setValue($uid);
        } else {
            $vevent->add('UID', $uid);
        }

        $showWithoutTime = (bool) ($masterEvent['showWithoutTime'] ?? false);
        $timeZone = isset($masterEvent['timeZone']) && is_string($masterEvent['timeZone']) ? $masterEvent['timeZone'] : null;

        ICalendarDateTime::writeProperty(
            $vevent,
            'DTSTART',
            $recurrenceIdKey,
            $showWithoutTime,
            $timeZone,
        );
        self::writeRecurrenceIdProperty($vevent, $recurrenceIdKey, $masterEvent);
        if (isset($vevent->STATUS)) {
            $vevent->STATUS->setValue('CANCELLED');
        } else {
            $vevent->add('STATUS', 'CANCELLED');
        }
        $now = gmdate('Ymd\THis\Z');
        if (isset($vevent->DTSTAMP)) {
            $vevent->DTSTAMP->setValue($now);
        } else {
            $vevent->add('DTSTAMP', $now);
        }
    }
}

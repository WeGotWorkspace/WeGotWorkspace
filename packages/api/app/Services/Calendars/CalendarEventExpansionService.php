<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Calendars\Conversion\RecurrenceOverrideSupport;
use App\Services\Calendars\Conversion\VEventToJmapEventConverter;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\Log;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Property;
use Sabre\VObject\Property\ICalendar\DateTime as IcsDateTime;
use Sabre\VObject\Property\ICalendar\Duration;
use Sabre\VObject\Reader;
use Sabre\VObject\Recur\EventIterator;
use Sabre\VObject\Recur\MaxInstancesExceededException;
use Sabre\VObject\Recur\NoInstancesException;

/**
 * Server-side recurrence expansion using Sabre EventIterator (#159).
 */
final class CalendarEventExpansionService
{
    public function __construct(
        private readonly VEventToJmapEventConverter $reader = new VEventToJmapEventConverter,
    ) {}

    /**
     * @param  array<string, mixed>  $masterEvent
     * @return list<array<string, mixed>>
     */
    public function expandInWindow(
        array $masterEvent,
        string $ics,
        string $calendarUri,
        string $after,
        string $before,
    ): array {
        if (! $this->isRecurring($masterEvent)) {
            return [$masterEvent];
        }

        $document = Reader::read($ics);
        if (! $document instanceof VCalendar) {
            return [$masterEvent];
        }

        $uid = is_string($masterEvent['uid'] ?? null) ? $masterEvent['uid'] : '';
        if ($uid === '') {
            return [$masterEvent];
        }

        $vevents = RecurrenceOverrideSupport::veventsForEventIterator($document, $uid);
        if ($vevents === []) {
            return [$masterEvent];
        }

        $timeZone = $this->resolveTimeZone($masterEvent);
        $start = new DateTimeImmutable($after, $timeZone);
        $end = new DateTimeImmutable($before, $timeZone);
        $vevents = $this->shiftLongSeriesNearWindow($vevents, $start);

        try {
            $iterator = new EventIterator($vevents, null, $timeZone);
            $iterator->fastForward($start);
            $masterId = is_string($masterEvent['id'] ?? null) ? $masterEvent['id'] : '';
            $instances = [];

            while ($iterator->valid() && $iterator->getDtStart() < $end) {
                if ($iterator->getDtEnd() <= $start) {
                    $iterator->next();

                    continue;
                }

                $expandedVevent = $iterator->getEventObject();
                $instance = $this->reader->convertVEvent($expandedVevent, $document);
                $recurrenceId = isset($expandedVevent->{'RECURRENCE-ID'})
                    ? RecurrenceOverrideSupport::recurrenceIdKeyFromProperty($expandedVevent->{'RECURRENCE-ID'})
                    : $instance['start'] ?? '';

                $instance['id'] = $masterId.'/'.$this->encodeRecurrenceIdForId($recurrenceId);
                $instance['recurrenceId'] = $recurrenceId;
                $instance['recurrenceRules'] = null;
                unset($instance['recurrenceOverrides']);
                $instance['calendarIds'] = [$calendarUri => true];
                $instance = $this->inheritMasterDeclinedPartstat($masterEvent, $instance);

                $instances[] = $instance;
                $iterator->next();
            }

            return $instances;
        } catch (NoInstancesException) {
            return [];
        } catch (MaxInstancesExceededException) {
            Log::warning('calendar.recurrence_limit', [
                'uid' => $uid,
                'calendarUri' => $calendarUri,
            ]);

            return [];
        }
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public function isRecurring(array $event): bool
    {
        $rules = $event['recurrenceRules'] ?? null;
        if (is_array($rules) && $rules !== []) {
            return true;
        }

        $overrides = $event['recurrenceOverrides'] ?? null;
        if (! is_array($overrides)) {
            return false;
        }

        foreach ($overrides as $patch) {
            if (is_array($patch) && $patch === []) {
                return true;
            }
        }

        return false;
    }

    /**
     * Series decline lives on the master. Exception VEVENTs often still carry
     * ACCEPTED/NEEDS-ACTION; treat those as declined unless the instance is an
     * explicit later this-instance accept/tentative.
     *
     * @param  array<string, mixed>  $master
     * @param  array<string, mixed>  $instance
     * @return array<string, mixed>
     */
    private function inheritMasterDeclinedPartstat(array $master, array $instance): array
    {
        $masterParticipants = is_array($master['participants'] ?? null) ? $master['participants'] : [];
        $instanceParticipants = is_array($instance['participants'] ?? null) ? $instance['participants'] : [];
        if ($masterParticipants === [] || $instanceParticipants === []) {
            return $instance;
        }

        $masterByEmail = [];
        foreach ($masterParticipants as $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = strtolower(trim((string) ($entry['email'] ?? '')));
            if ($email === '') {
                continue;
            }
            $masterByEmail[$email] = strtolower(trim((string) ($entry['participationStatus'] ?? '')));
        }

        $changed = false;
        foreach ($instanceParticipants as $id => $entry) {
            if (! is_array($entry)) {
                continue;
            }
            $email = strtolower(trim((string) ($entry['email'] ?? '')));
            if ($email === '' || ($masterByEmail[$email] ?? '') !== 'declined') {
                continue;
            }
            $instanceStatus = strtolower(trim((string) ($entry['participationStatus'] ?? 'needs-action')));
            if (in_array($instanceStatus, ['accepted', 'tentative'], true)) {
                continue;
            }
            $entry['participationStatus'] = 'declined';
            $instanceParticipants[$id] = $entry;
            $changed = true;
        }
        if ($changed) {
            $instance['participants'] = $instanceParticipants;
        }

        return $instance;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function resolveTimeZone(array $event): DateTimeZone
    {
        $tzid = isset($event['timeZone']) && is_string($event['timeZone']) ? trim($event['timeZone']) : '';
        if ($tzid !== '') {
            try {
                return new DateTimeZone($tzid);
            } catch (\Exception) {
                // Fall through to UTC.
            }
        }

        return new DateTimeZone('UTC');
    }

    private function encodeRecurrenceIdForId(string $recurrenceId): string
    {
        return rawurlencode($recurrenceId);
    }

    /**
     * Unlimited daily/weekly series are shifted onto the same grid so the
     * iterator starts just before the window instead of walking from DTSTART.
     * The anchor steps back by the master duration so an occurrence that
     * starts before the window can still overlap it.
     * EXDATE and RECURRENCE-ID values stay absolute.
     *
     * @param  list<VEvent>  $vevents
     * @return list<VEvent>
     */
    private function shiftLongSeriesNearWindow(array $vevents, DateTimeImmutable $windowStart): array
    {
        $masterIndex = null;
        foreach ($vevents as $index => $vevent) {
            if (! isset($vevent->{'RECURRENCE-ID'})) {
                $masterIndex = $index;
                break;
            }
        }
        if ($masterIndex === null) {
            return $vevents;
        }

        $master = $vevents[$masterIndex];
        $rule = $this->shiftableRule($master);
        $startProp = $master->DTSTART ?? null;
        if ($rule === null || ! $startProp instanceof IcsDateTime) {
            return $vevents;
        }

        $origin = DateTimeImmutable::createFromInterface($startProp->getDateTime());
        $firstInWindow = $this->firstStepAtOrAfter($origin, $windowStart, $rule['frequency'], $rule['interval']);
        $stepSeconds = $rule['interval'] * ($rule['frequency'] === 'WEEKLY' ? 604800 : 86400);
        $durationSteps = (int) ceil($this->masterDurationSeconds($master) / $stepSeconds);
        $anchorSteps = max(0, $firstInWindow - 1 - $durationSteps);
        if ($anchorSteps <= 1000) {
            return $vevents;
        }

        $anchored = clone $master;
        $this->moveAnchoredDates(
            $anchored,
            $this->addSteps($origin, $rule['frequency'], $rule['interval'], $anchorSteps),
        );
        $vevents[$masterIndex] = $anchored;

        return array_values($vevents);
    }

    /**
     * @return array{frequency: string, interval: int}|null
     */
    private function shiftableRule(VEvent $master): ?array
    {
        $rules = [];
        foreach ($master->select('RRULE') as $property) {
            if ($property instanceof Property) {
                $rules[] = $property->getParts();
            }
        }
        if (count($rules) !== 1) {
            return null;
        }

        $parts = $rules[0];
        $frequency = strtoupper((string) ($parts['FREQ'] ?? ''));
        if (! in_array($frequency, ['DAILY', 'WEEKLY'], true) || isset($parts['COUNT'])) {
            return null;
        }
        foreach (['BYSETPOS', 'BYMONTH', 'BYMONTHDAY', 'BYYEARDAY', 'BYWEEKNO'] as $blocker) {
            if (isset($parts[$blocker])) {
                return null;
            }
        }
        if ($frequency === 'DAILY' && isset($parts['BYDAY'])) {
            return null;
        }

        $interval = $this->ruleInterval($parts);
        if ($interval < 1) {
            return null;
        }

        return ['frequency' => $frequency, 'interval' => $interval];
    }

    /**
     * Seconds the master occupies. DTEND wins, then DURATION. A DATE value
     * with neither lasts one day; a DATE-TIME with neither lasts zero.
     */
    private function masterDurationSeconds(VEvent $master): int
    {
        $startProp = $master->DTSTART ?? null;
        if (! $startProp instanceof IcsDateTime) {
            return 0;
        }

        if (isset($master->DTEND) && $master->DTEND instanceof IcsDateTime) {
            $start = DateTimeImmutable::createFromInterface($startProp->getDateTime());
            $end = DateTimeImmutable::createFromInterface($master->DTEND->getDateTime());

            return max(0, $end->getTimestamp() - $start->getTimestamp());
        }

        if (isset($master->DURATION) && $master->DURATION instanceof Duration) {
            return $this->dateIntervalSeconds($master->DURATION->getDateInterval());
        }

        if (! $startProp->hasTime()) {
            return 86400;
        }

        return 0;
    }

    private function dateIntervalSeconds(DateInterval $interval): int
    {
        if ($interval->invert === 1) {
            return 0;
        }

        return ((($interval->d * 24) + $interval->h) * 60 + $interval->i) * 60 + $interval->s;
    }

    /**
     * @param  array<mixed>  $parts
     */
    private function ruleInterval(array $parts): int
    {
        if (! isset($parts['INTERVAL'])) {
            return 1;
        }
        $raw = $parts['INTERVAL'];
        if (is_array($raw)) {
            $raw = $raw[0] ?? 1;
        }

        return (int) $raw;
    }

    private function firstStepAtOrAfter(
        DateTimeImmutable $origin,
        DateTimeImmutable $windowStart,
        string $frequency,
        int $interval,
    ): int {
        if ($this->addSteps($origin, $frequency, $interval, 0) >= $windowStart) {
            return 0;
        }

        $high = 1;
        while ($this->addSteps($origin, $frequency, $interval, $high) < $windowStart) {
            if ($high > 2_000_000) {
                return $high;
            }
            $high *= 2;
        }

        $low = intdiv($high, 2);
        while ($low < $high) {
            $mid = intdiv($low + $high, 2);
            if ($this->addSteps($origin, $frequency, $interval, $mid) < $windowStart) {
                $low = $mid + 1;
            } else {
                $high = $mid;
            }
        }

        return $low;
    }

    private function addSteps(DateTimeImmutable $origin, string $frequency, int $interval, int $steps): DateTimeImmutable
    {
        if ($steps === 0) {
            return $origin;
        }
        $unit = $frequency === 'WEEKLY' ? 'weeks' : 'days';

        return $origin->modify(sprintf('+%d %s', $steps * $interval, $unit));
    }

    private function moveAnchoredDates(VEvent $master, DateTimeImmutable $newStart): void
    {
        $startProp = $master->DTSTART;
        if (! $startProp instanceof IcsDateTime) {
            return;
        }

        $origin = DateTimeImmutable::createFromInterface($startProp->getDateTime());
        $startProp->setDateTime($newStart, (bool) $startProp->isFloating());
        foreach (['DTEND', 'DUE'] as $name) {
            if (! isset($master->{$name})) {
                continue;
            }
            $prop = $master->{$name};
            if (! $prop instanceof IcsDateTime) {
                continue;
            }
            $current = DateTimeImmutable::createFromInterface($prop->getDateTime());
            $prop->setDateTime($newStart->add($origin->diff($current)), (bool) $prop->isFloating());
        }
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\DateTimeParser;
use Sabre\VObject\Property\ICalendar\DateTime as IcsDateTime;
use Sabre\VObject\Recur\EventIterator;
use Sabre\VObject\Recur\NoInstancesException;

/**
 * Whether a scheduling VEVENT still has any occurrence after {@code $now}.
 *
 * One-off: DTEND (else DURATION, else DATE +1 day, else DTSTART) must be after now.
 * Series (RRULE / RDATE): Sabre {@see EventIterator} — keep if any instance ends after now
 * (UNTIL/COUNT not exhausted, or the last instance has not ended).
 */
final class CalendarSchedulingInviteHorizon
{
    public function continuesAfter(VEvent $vevent, DateTimeImmutable $now): bool
    {
        if (! isset($vevent->DTSTART)) {
            return true;
        }

        try {
            if ($this->isSeries($vevent)) {
                return $this->seriesContinuesAfter($vevent, $now);
            }

            return $this->effectiveEnd($vevent, $now->getTimezone()) > $now;
        } catch (\Throwable) {
            return true;
        }
    }

    private function isSeries(VEvent $vevent): bool
    {
        return isset($vevent->RRULE) || isset($vevent->RDATE);
    }

    private function seriesContinuesAfter(VEvent $vevent, DateTimeImmutable $now): bool
    {
        $uid = trim((string) ($vevent->UID ?? ''));
        $parent = $vevent->parent;
        $input = $parent instanceof VCalendar && $uid !== '' ? $parent : $vevent;

        try {
            $iterator = $input instanceof VCalendar
                ? new EventIterator($input, $uid, $now->getTimezone())
                : new EventIterator($vevent, null, $now->getTimezone());
        } catch (NoInstancesException) {
            return false;
        }

        $iterator->fastForward($now);

        return $iterator->valid() && $iterator->getDtEnd() > $now;
    }

    private function effectiveEnd(VEvent $vevent, DateTimeZone $timeZone): DateTimeInterface
    {
        $startProp = $vevent->DTSTART;
        if (! $startProp instanceof IcsDateTime) {
            throw new \InvalidArgumentException('VEVENT DTSTART is not a date-time.');
        }
        $start = $startProp->getDateTime($timeZone);
        if (isset($vevent->DTEND)) {
            $endProp = $vevent->DTEND;
            if (! $endProp instanceof IcsDateTime) {
                throw new \InvalidArgumentException('VEVENT DTEND is not a date-time.');
            }
            $end = $endProp->getDateTime($timeZone);

            return $end;
        }
        if (isset($vevent->DURATION)) {
            $duration = DateTimeParser::parseDuration((string) $vevent->DURATION);
            if (! $duration instanceof \DateInterval) {
                throw new \InvalidArgumentException('VEVENT DURATION is not a duration.');
            }

            return $start->add($duration);
        }
        if (! $startProp->hasTime()) {
            return $start->modify('+1 day');
        }

        return $start;
    }
}

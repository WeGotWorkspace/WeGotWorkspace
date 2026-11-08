<?php

declare(strict_types=1);

namespace App\Dav\Server;

use App\Services\Calendars\Availability\AvailabilityAudience;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\CalendarPrincipalAddresses;
use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use Sabre\CalDAV\Schedule\Plugin as SchedulePlugin;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\VObject\Component;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\Property;

/**
 * CalDAV scheduling with the outbox free/busy report under the Team
 * availability rules (#1907). Sabre answers for every principal; here the
 * target is answered only when the caller may read their availability (shared
 * Team or self, switch on, enabled). The busy time comes from the calculator
 * over the whole UTC weeks covering the window, clipped back to it, without
 * titles. Anything else, a window over 54 covering weeks, or an incomplete
 * result answers as for an unknown address, so a client never reads a gap
 * as free time.
 */
final class WgwSchedulePlugin extends SchedulePlugin
{
    private const UNKNOWN = '3.7;Could not find principal';

    private const WEEK_SECONDS = 604800;

    public function __construct(
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly AvailabilityAudience $audience,
        private readonly AvailabilityCalculator $calculator,
    ) {}

    /**
     * @param  string  $email
     * @return array<string, mixed>
     */
    protected function getFreeBusyForEmail($email, DateTimeInterface $start, DateTimeInterface $end, Component $request)
    {
        $mailto = str_starts_with(strtolower($email), 'mailto:') ? $email : 'mailto:'.$email;
        $unknown = ['request-status' => self::UNKNOWN, 'href' => $mailto];

        $caller = $this->username($this->currentPrincipal());
        $target = $this->username($this->addresses->principalForMailto($mailto)?->uri);
        if ($caller === null || $target === null || ! $this->audience->mayRead($caller, $target)) {
            return $unknown;
        }

        $from = $start->getTimestamp();
        $until = $end->getTimestamp();
        $weekStarts = self::coveringWeeks($from, $until);
        if ($weekStarts === [] || count($weekStarts) > AvailabilityCalculator::MAX_WEEKS) {
            return $unknown;
        }
        $result = $this->calculator->busyPeriods($target, $weekStarts);
        if ($result === null || ! $result->complete()) {
            return $unknown;
        }

        $busy = [];
        foreach ($result->entries as $entry) {
            $busyStart = max($entry['utcStart'], $from);
            $busyEnd = min($entry['utcEnd'], $until);
            if ($busyEnd > $busyStart) {
                $busy[] = [$busyStart, $busyEnd];
            }
        }

        $vcalendar = new VCalendar;
        $vcalendar->add('METHOD', 'REPLY');
        $freeBusy = $vcalendar->add('VFREEBUSY', [
            'DTSTART' => self::utc($from),
            'DTEND' => self::utc($until),
            'DTSTAMP' => new DateTimeImmutable('now', new DateTimeZone('UTC')),
        ]);
        foreach (self::merged($busy) as [$busyStart, $busyEnd]) {
            $freeBusy->add('FREEBUSY', self::utc($busyStart)->format('Ymd\\THis\\Z').'/'.self::utc($busyEnd)->format('Ymd\\THis\\Z'));
        }
        $freeBusy->add('ATTENDEE', $mailto);
        $asked = $request->select('VFREEBUSY')[0] ?? null;
        $uid = $asked instanceof Component ? ($asked->select('UID')[0] ?? null) : null;
        $freeBusy->add('UID', $uid instanceof Property ? (string) $uid : '');
        $organizer = $asked instanceof Component ? ($asked->select('ORGANIZER')[0] ?? null) : null;
        if ($organizer instanceof Property) {
            $freeBusy->add(clone $organizer);
        }

        return [
            'calendar-data' => $vcalendar,
            'request-status' => '2.0;Success',
            'href' => $mailto,
        ];
    }

    /**
     * Monday 00:00 UTC of every week that overlaps [from, until).
     *
     * @return list<int>
     */
    public static function coveringWeeks(int $from, int $until): array
    {
        if ($until <= $from) {
            return [];
        }
        // 1970-01-05 (Unix 345600) was a Monday.
        $first = $from - (($from - 345600) % self::WEEK_SECONDS + self::WEEK_SECONDS) % self::WEEK_SECONDS;
        $weeks = [];
        for ($week = $first; $week < $until && count($weeks) <= AvailabilityCalculator::MAX_WEEKS; $week += self::WEEK_SECONDS) {
            $weeks[] = $week;
        }

        return $weeks;
    }

    /**
     * @param  list<array{0: int, 1: int}>  $busy
     * @return list<array{0: int, 1: int}>
     */
    private static function merged(array $busy): array
    {
        usort($busy, static fn (array $a, array $b): int => $a[0] <=> $b[0] ?: $a[1] <=> $b[1]);
        $merged = [];
        foreach ($busy as $period) {
            $last = array_key_last($merged);
            if ($last !== null && $period[0] <= $merged[$last][1]) {
                $merged[$last][1] = max($merged[$last][1], $period[1]);

                continue;
            }
            $merged[] = $period;
        }

        return $merged;
    }

    private function currentPrincipal(): ?string
    {
        $auth = $this->server->getPlugin('auth');

        return $auth instanceof AuthPlugin ? $auth->getCurrentPrincipal() : null;
    }

    private function username(?string $principalUri): ?string
    {
        if ($principalUri === null || ! preg_match('#^principals/([^/]+)$#', $principalUri, $matches)) {
            return null;
        }

        return $matches[1];
    }

    private static function utc(int $timestamp): DateTimeImmutable
    {
        return (new DateTimeImmutable('@'.$timestamp))->setTimezone(new DateTimeZone('UTC'));
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Calendars\Conversion\CalendarConversionSupport;
use App\Services\Calendars\Conversion\LocationConversionSupport;
use App\Services\Calendars\Conversion\RecurrenceOverrideSupport;
use App\Services\VObject\ICalendarDateTime;
use DateInterval;
use DateTimeImmutable;
use Sabre\VObject\Component\VEvent;
use Sabre\VObject\Reader;

/**
 * @phpstan-type MeetLinkRoom array{
 *     code: string,
 *     expiresAt: DateTimeImmutable|null,
 *     scope: 'series'|'single'|'instance',
 *     end: string|null
 * }
 */
final class CalendarMeetLinkIcsAnalysis
{
    public const EXPIRY_GRACE_DAYS = 7;

    public function __construct(
        private readonly CalendarMeetLinkHref $hrefs = new CalendarMeetLinkHref,
    ) {}

    /**
     * @return list<MeetLinkRoom>
     */
    public function rooms(string $ics): array
    {
        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            return [];
        }

        $vevents = CalendarConversionSupport::veventsFromCalendar($document);
        $rooms = [];
        foreach (RecurrenceOverrideSupport::groupRecurrenceSeries($vevents) as $series) {
            $master = $series['master'];
            $isSeries = isset($master->RRULE);
            $masterHref = LocationConversionSupport::conferenceHrefFromVEvent($master);
            $masterCode = $masterHref !== null ? $this->hrefs->parseWgwRoom($masterHref) : null;
            $masterEnd = $this->endInstant($master);

            if ($masterCode !== null) {
                $rooms[] = [
                    'code' => $masterCode,
                    'expiresAt' => $isSeries ? null : $this->plusGrace($masterEnd),
                    'scope' => $isSeries ? 'series' : 'single',
                    'end' => $masterEnd,
                ];
            }

            foreach ($series['overrides'] as $override) {
                if (! $override instanceof VEvent) {
                    continue;
                }
                $href = LocationConversionSupport::conferenceHrefFromVEvent($override);
                $code = $href !== null ? $this->hrefs->parseWgwRoom($href) : null;
                if ($code === null || $code === $masterCode) {
                    continue;
                }
                $end = $this->endInstant($override) ?? $masterEnd;
                $rooms[] = [
                    'code' => $code,
                    'expiresAt' => $this->plusGrace($end),
                    'scope' => 'instance',
                    'end' => $end,
                ];
            }
        }

        return $rooms;
    }

    public function primaryUid(string $ics): ?string
    {
        try {
            $document = Reader::read($ics);
        } catch (\Throwable) {
            return null;
        }
        $vevent = CalendarConversionSupport::primaryVEvent($document);
        if (! $vevent instanceof VEvent || ! isset($vevent->UID)) {
            return null;
        }
        $uid = trim((string) $vevent->UID->getValue());

        return $uid !== '' ? $uid : null;
    }

    private function endInstant(VEvent $vevent): ?string
    {
        if (isset($vevent->DTEND)) {
            $end = ICalendarDateTime::fromProperty($vevent->DTEND)['value'];

            return $end !== '' ? $end : null;
        }
        if (! isset($vevent->DTSTART) || ! isset($vevent->DURATION)) {
            return null;
        }
        $start = ICalendarDateTime::fromProperty($vevent->DTSTART)['value'];
        if ($start === '') {
            return null;
        }
        try {
            $startDt = new DateTimeImmutable($start);
            $interval = new DateInterval(trim((string) $vevent->DURATION->getValue()));
        } catch (\Exception) {
            return null;
        }

        return $this->formatInstant($startDt->add($interval));
    }

    private function plusGrace(?string $end): ?DateTimeImmutable
    {
        if ($end === null || $end === '') {
            return null;
        }
        try {
            return (new DateTimeImmutable($end))->add(new DateInterval('P'.self::EXPIRY_GRACE_DAYS.'D'));
        } catch (\Exception) {
            return null;
        }
    }

    private function formatInstant(DateTimeImmutable $instant): string
    {
        if ($instant->getOffset() === 0) {
            return $instant->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
        }

        return $instant->format('Y-m-d\TH:i:s');
    }
}

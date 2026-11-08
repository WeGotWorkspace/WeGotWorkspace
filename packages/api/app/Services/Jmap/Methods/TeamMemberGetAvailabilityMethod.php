<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\Availability\AvailabilityAudience;
use App\Services\Calendars\Availability\AvailabilityCalculator;
use App\Services\Calendars\Availability\AvailabilityExcludedEvent;
use App\Services\Calendars\Availability\AvailabilityOccurrenceReader;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * TeamMember/getAvailability (urn:wgw:jmap:availability, #1909): busy
 * periods per person over whole UTC weeks. Every size and range rule is
 * checked before any read. Anyone the caller may not read lands in
 * `notFound`, whatever the reason.
 */
final class TeamMemberGetAvailabilityMethod implements JmapMethodInterface
{
    public function __construct(
        private readonly AvailabilityAudience $audience,
        private readonly AvailabilityCalculator $calculator,
        private readonly AvailabilityExcludedEvent $excludedEvent,
    ) {}

    public function name(): string
    {
        return 'TeamMember/getAvailability';
    }

    public function capability(): string
    {
        return JmapCapabilities::AVAILABILITY;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $limits = JmapCapabilities::availabilityAccountCapability();
        $ids = $this->ids($args['ids'] ?? null, $limits['maxIdsPerCall']);
        $weeks = $this->weeks($args['utcStart'] ?? null, $args['utcEnd'] ?? null, $limits['maxWeeksPerCall']);
        if (count($ids) * count($weeks) > $limits['maxPersonWeeksPerCall']) {
            throw new JmapMethodException('invalidArguments', 'ids × weeks exceeds maxPersonWeeksPerCall; split the request.');
        }
        $excludeUid = $this->excludeUid($username, $args['excludeEventId'] ?? null);

        $list = [];
        $notFound = [];
        foreach ($ids as $id) {
            $result = $this->audience->mayRead($username, $id)
                ? $this->calculator->busyPeriods($id, $weeks, $excludeUid)
                : null;
            if ($result === null) {
                $notFound[] = $id;

                continue;
            }
            $list[] = ['id' => $id, 'periods' => $result->periods(), 'complete' => $result->complete()];
        }

        return ['accountId' => $username, 'list' => $list, 'notFound' => $notFound];
    }

    /**
     * @return list<string>
     */
    private function ids(mixed $ids, int $max): array
    {
        if (! is_array($ids) || ! array_is_list($ids) || $ids === []) {
            throw new JmapMethodException('invalidArguments', 'ids must be a non-empty array of ids.');
        }
        foreach ($ids as $id) {
            if (! is_string($id) || $id === '') {
                throw new JmapMethodException('invalidArguments', 'ids must contain non-empty strings.');
            }
        }
        $ids = array_values(array_unique($ids));
        if (count($ids) > $max) {
            throw new JmapMethodException('invalidArguments', 'ids exceeds maxIdsPerCall.');
        }

        return $ids;
    }

    /**
     * Whole UTC weeks: utcStart a Monday 00:00:00Z, utcEnd a whole number of
     * weeks later, so cache keys stay canonical.
     *
     * @return list<int>
     */
    private function weeks(mixed $utcStart, mixed $utcEnd, int $maxWeeks): array
    {
        $start = self::utcSeconds($utcStart);
        $end = self::utcSeconds($utcEnd);
        if ($start === null || $end === null) {
            throw new JmapMethodException('invalidArguments', 'utcStart and utcEnd must be UTC date-times like 2030-01-07T00:00:00Z.');
        }
        if (! AvailabilityCalculator::isWeekStart($start)) {
            throw new JmapMethodException('invalidArguments', 'utcStart must be a Monday 00:00:00Z.');
        }
        $span = $end - $start;
        $week = AvailabilityOccurrenceReader::WEEK_SECONDS;
        if ($span <= 0 || $span % $week !== 0) {
            throw new JmapMethodException('invalidArguments', 'utcEnd must be a whole number of weeks after utcStart.');
        }
        if (intdiv($span, $week) > $maxWeeks) {
            throw new JmapMethodException('invalidArguments', 'The range exceeds maxWeeksPerCall.');
        }

        return range($start, $end - $week, $week);
    }

    private static function utcSeconds(mixed $value): ?int
    {
        if (! is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/', $value) !== 1) {
            return null;
        }
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', $value, new \DateTimeZone('UTC'));

        return $parsed !== false && $parsed->format('Y-m-d\TH:i:s\Z') === $value ? $parsed->getTimestamp() : null;
    }

    private function excludeUid(string $username, mixed $eventId): ?string
    {
        if ($eventId === null) {
            return null;
        }
        $uid = is_string($eventId) && $eventId !== '' ? $this->excludedEvent->uidFor($username, $eventId) : null;
        if ($uid === null) {
            throw new JmapMethodException('invalidArguments', 'excludeEventId must be an event you may edit, organize or attend.');
        }

        return $uid;
    }
}

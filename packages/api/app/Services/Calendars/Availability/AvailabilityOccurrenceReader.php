<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarEventExpansionService;
use App\Services\Calendars\CalendarEventQuerySupport;
use App\Services\Calendars\CalendarPrincipalAddresses;
use App\Services\Calendars\Conversion\ICalendarJmapEventConverter;
use App\Services\VObject\VObjectPayloadGuard;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Support\Facades\Log;
use Sabre\VObject\Recur\MaxInstancesExceededException;

/**
 * Reads one whole UTC week of an owner's busy occurrences from their source
 * calendars, unredacted, for the week cache. Only reads.
 *
 * Per occurrence: "Show as: Free" and cancelled never count; on personal
 * sources an occurrence the owner declined does not count either. Team
 * sources ignore attendees, organizer and replies: a Team event counts for
 * every member. An object it cannot read (too large, unparseable) or a series
 * over the recurrence limit is skipped, logged, and makes the week incomplete.
 *
 * @phpstan-type Occurrence array{
 *     calendarId: int,
 *     kind: string,
 *     private: bool,
 *     title: string|null,
 *     location: string|null,
 *     uid: string,
 *     start: string,
 *     timeZone: string|null,
 *     duration: string,
 *     showWithoutTime: bool,
 *     utcStart: int,
 *     utcEnd: int
 * }
 */
final class AvailabilityOccurrenceReader
{
    public const KIND_PERSONAL = 'personal';

    public const KIND_TEAM = 'team';

    public const MAX_PERIODS_PER_WEEK = 2000;

    public const WEEK_SECONDS = 604_800;

    public function __construct(
        private readonly CalendarEventQuerySupport $queries,
        private readonly CalendarEventExpansionService $expansion,
        private readonly CalendarPrincipalAddresses $addresses,
        private readonly AvailabilityWeekCache $cache,
        private readonly ICalendarJmapEventConverter $converter = new ICalendarJmapEventConverter,
    ) {}

    /**
     * @param  array{personal: list<CalendarInstance>, team: list<CalendarInstance>}  $sources
     * @return array{occurrences: list<Occurrence>, complete: bool, objects: int}
     */
    public function readWeek(string $owner, array $sources, int $weekStart): array
    {
        $window = [
            'after' => (new DateTimeImmutable('@'.$weekStart))->setTimezone(new DateTimeZone('UTC')),
            'before' => (new DateTimeImmutable('@'.($weekStart + self::WEEK_SECONDS)))->setTimezone(new DateTimeZone('UTC')),
        ];
        $ownerAddresses = array_map('strtolower', $this->addresses->addressesForUsername($owner));
        $occurrences = [];
        $complete = true;
        $objects = 0;

        foreach ([self::KIND_PERSONAL, self::KIND_TEAM] as $kind) {
            foreach ($sources[$kind] as $instance) {
                foreach ($this->queries->candidateObjects($instance, $window, ['uri', 'calendardata']) as $object) {
                    $objects++;
                    $raw = (string) $object->calendardata;
                    $context = ['calendarId' => (int) $instance->calendarid, 'objectId' => (int) $object->id];
                    $events = $this->parse($raw, $context);
                    if ($events === null) {
                        $complete = false;

                        continue;
                    }
                    foreach ($events as $event) {
                        $expanded = $this->occurrencesInWindow($event, $raw, $window, $context);
                        if ($expanded === null) {
                            $complete = false;

                            continue;
                        }
                        foreach ($expanded as $occurrence) {
                            if ($this->counts($occurrence, $kind, $ownerAddresses)) {
                                $occurrences[] = $this->entry($occurrence, (int) $instance->calendarid, $kind);
                            }
                        }
                    }
                }
            }
        }

        usort($occurrences, static fn (array $a, array $b): int => [$a['utcStart'], $a['utcEnd']] <=> [$b['utcStart'], $b['utcEnd']]);
        if (count($occurrences) > self::MAX_PERIODS_PER_WEEK) {
            $occurrences = array_slice($occurrences, 0, self::MAX_PERIODS_PER_WEEK);
            $complete = false;
        }

        return ['occurrences' => $occurrences, 'complete' => $complete, 'objects' => $objects];
    }

    /**
     * @param  array{calendarId: int, objectId: int}  $context
     * @return list<array<string, mixed>>|null null when the object was skipped
     */
    private function parse(string $raw, array $context): ?array
    {
        if (strlen($raw) > VObjectPayloadGuard::MAX_ICS_BYTES) {
            Log::warning('calendar.availability.object_skipped', $context + ['reason' => 'too_large']);

            return null;
        }

        try {
            return $this->converter->eventsFromIcs($raw);
        } catch (\Throwable) {
            Log::warning('calendar.availability.object_skipped', $context + ['reason' => 'unreadable']);

            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $event
     * @param  array{after: DateTimeImmutable, before: DateTimeImmutable}  $window
     * @param  array{calendarId: int, objectId: int}  $context
     * @return list<array<string, mixed>>|null null when the series was skipped
     */
    private function occurrencesInWindow(array $event, string $raw, array $window, array $context): ?array
    {
        if (! $this->expansion->isRecurring($event)) {
            [$start, $end] = self::utcBounds($event);

            return self::touches($start, $end, $window) ? [$event] : [];
        }

        try {
            return $this->expansion->expandInWindowOrFail(
                $event,
                $raw,
                'availability',
                $window['after']->format('Y-m-d\TH:i:s\Z'),
                $window['before']->format('Y-m-d\TH:i:s\Z'),
            );
        } catch (MaxInstancesExceededException) {
            Log::warning('calendar.availability.object_skipped', $context + ['reason' => 'recurrence_limit']);

            return null;
        }
    }

    /**
     * @param  array<string, mixed>  $occurrence
     * @param  list<string>  $ownerAddresses
     */
    private function counts(array $occurrence, string $kind, array $ownerAddresses): bool
    {
        if (($occurrence['freeBusyStatus'] ?? 'busy') === 'free' || ($occurrence['status'] ?? null) === 'cancelled') {
            return false;
        }

        return $kind === self::KIND_TEAM || ! $this->ownerDeclined($occurrence, $ownerAddresses);
    }

    /**
     * @param  array<string, mixed>  $occurrence
     * @param  list<string>  $ownerAddresses
     */
    private function ownerDeclined(array $occurrence, array $ownerAddresses): bool
    {
        $participants = is_array($occurrence['participants'] ?? null) ? $occurrence['participants'] : [];
        foreach ($participants as $key => $participant) {
            if ($key === 'org' || ! is_array($participant)) {
                continue;
            }
            $address = 'mailto:'.strtolower(trim((string) ($participant['email'] ?? '')));
            if (in_array($address, $ownerAddresses, true) && ($participant['participationStatus'] ?? null) === 'declined') {
                return true;
            }
        }

        return false;
    }

    /**
     * @param  array<string, mixed>  $occurrence
     * @return Occurrence
     */
    private function entry(array $occurrence, int $calendarId, string $kind): array
    {
        [$utcStart, $utcEnd] = self::utcBounds($occurrence);
        $showWithoutTime = ($occurrence['showWithoutTime'] ?? false) === true;
        $timeZone = is_string($occurrence['timeZone'] ?? null) && $occurrence['timeZone'] !== '' ? $occurrence['timeZone'] : null;

        return [
            'calendarId' => $calendarId,
            'kind' => $kind,
            'private' => in_array($occurrence['privacy'] ?? null, ['private', 'secret'], true),
            'title' => self::text($occurrence['title'] ?? null),
            'location' => self::firstLocationName($occurrence),
            'uid' => $this->cache->uidHmac((string) ($occurrence['uid'] ?? '')),
            'start' => (string) ($occurrence['start'] ?? ''),
            'timeZone' => $timeZone,
            'duration' => self::duration($occurrence, $showWithoutTime),
            'showWithoutTime' => $showWithoutTime,
            'utcStart' => $utcStart,
            'utcEnd' => $utcEnd,
        ];
    }

    /**
     * Instants of an occurrence. Floating and all-day times are read as UTC,
     * the same reading Sabre's firstoccurence/lastoccurence columns use.
     *
     * @param  array<string, mixed>  $event
     * @return array{0: int, 1: int}
     */
    private static function utcBounds(array $event): array
    {
        $zone = new DateTimeZone('UTC');
        if (is_string($event['timeZone'] ?? null) && $event['timeZone'] !== '') {
            try {
                $zone = new DateTimeZone($event['timeZone']);
            } catch (\Exception) {
                // Unknown TZID: read as UTC.
            }
        }

        try {
            $start = new DateTimeImmutable((string) ($event['start'] ?? ''), $zone);
            $end = $start->add(new DateInterval(self::duration($event, ($event['showWithoutTime'] ?? false) === true)));
        } catch (\Exception) {
            return [0, 0];
        }

        return [$start->getTimestamp(), max($start->getTimestamp(), $end->getTimestamp())];
    }

    /**
     * @param  array{after: DateTimeImmutable, before: DateTimeImmutable}  $window
     */
    private static function touches(int $start, int $end, array $window): bool
    {
        $after = $window['after']->getTimestamp();
        $before = $window['before']->getTimestamp();
        if ($start === 0 && $end === 0) {
            return false;
        }

        return $start < $before && ($end > $after || ($end === $start && $start >= $after));
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private static function duration(array $event, bool $showWithoutTime): string
    {
        $duration = $event['duration'] ?? null;
        if (is_string($duration) && $duration !== '' && $duration[0] === 'P') {
            try {
                new DateInterval($duration);

                return $duration;
            } catch (\Exception) {
                // Malformed: fall through to the default length.
            }
        }

        return $showWithoutTime ? 'P1D' : 'PT0S';
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private static function firstLocationName(array $event): ?string
    {
        $locations = is_array($event['locations'] ?? null) ? $event['locations'] : [];
        foreach ($locations as $location) {
            $name = is_array($location) ? self::text($location['name'] ?? null) : null;
            if ($name !== null) {
                return $name;
            }
        }

        return null;
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}

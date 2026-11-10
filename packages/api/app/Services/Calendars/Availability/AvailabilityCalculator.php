<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionAccess;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

/**
 * Computes a person's busy periods on request, in whole UTC weeks (Monday
 * 00:00 UTC), from their own personal and Team event calendars. Only reads.
 *
 * Each week is read from or filled into the week cache under the owner's
 * source fingerprint. The fingerprint is read again after the objects: when a
 * write landed in between, the fresh weeks are returned but not stored, so a
 * mid-read write is never cached as free. The owner's include and detail
 * choices and the excluded event apply after the read, so they show on the
 * next call without waiting for the cache to expire.
 *
 * Who may ask is the caller's concern (Team rule, switch, disabled users).
 */
final class AvailabilityCalculator
{
    public const MAX_WEEKS = 54;

    private const SLOW_CALL_MS = 500;

    public function __construct(
        private readonly CalendarCollectionAccess $collections,
        private readonly AvailabilitySettings $settings,
        private readonly AvailabilityWeekCache $cache,
        private readonly AvailabilityOccurrenceReader $reader,
        private readonly AvailabilityPeriodFilter $filter,
    ) {}

    /**
     * @param  list<int>  $weekStarts  Unix seconds, each a Monday 00:00 UTC
     * @param  string|null  $excludeUid  drop every occurrence of this event UID
     * @return AvailabilityResult|null null while the owner's switch is off
     *
     * @throws InvalidArgumentException when a week start is not a Monday 00:00 UTC or there are too many
     */
    public function busyPeriods(string $owner, array $weekStarts, ?string $excludeUid = null): ?AvailabilityResult
    {
        $weekStarts = array_values(array_unique($weekStarts));
        self::assertWeeks($weekStarts);
        if (! $this->settings->isEnabled($owner)) {
            return null;
        }

        $startedAt = hrtime(true);
        $sources = $this->collections->availabilitySourceInstances($owner);
        $fingerprint = $this->cache->fingerprint(self::flatten($sources));
        $weeks = [];
        $fresh = [];
        $objects = 0;
        foreach ($weekStarts as $weekStart) {
            $entry = $this->cache->get($owner, $weekStart, $fingerprint);
            if ($entry === null) {
                $read = $this->reader->readWeek($owner, $sources, $weekStart);
                $objects += $read['objects'];
                $entry = ['occurrences' => $read['occurrences'], 'complete' => $read['complete']];
                $fresh[$weekStart] = $entry;
            }
            $weeks[$weekStart] = $entry;
        }
        if ($fresh !== [] && $this->currentFingerprint($owner) === $fingerprint) {
            foreach ($fresh as $weekStart => $entry) {
                $this->cache->put($owner, $weekStart, $fingerprint, $entry);
            }
        }

        $result = $this->filter->apply(
            $weeks,
            $this->settings->prefs($owner),
            $excludeUid === null ? null : $this->cache->uidHmac($excludeUid),
        );
        $this->logIfSlow($startedAt, count(self::flatten($sources)), $objects, count($result->entries));

        return $result;
    }

    public static function isWeekStart(int $timestamp): bool
    {
        return gmdate('N H:i:s', $timestamp) === '1 00:00:00';
    }

    /**
     * @param  list<int>  $weekStarts
     */
    private static function assertWeeks(array $weekStarts): void
    {
        if (count($weekStarts) > self::MAX_WEEKS) {
            throw new InvalidArgumentException('At most '.self::MAX_WEEKS.' weeks per call.');
        }
        foreach ($weekStarts as $weekStart) {
            if (! self::isWeekStart($weekStart)) {
                throw new InvalidArgumentException('Every week must start on a Monday 00:00 UTC.');
            }
        }
    }

    private function currentFingerprint(string $owner): string
    {
        return $this->cache->fingerprint(self::flatten($this->collections->availabilitySourceInstances($owner)));
    }

    /**
     * @param  array{personal: list<CalendarInstance>, team: list<CalendarInstance>}  $sources
     * @return list<CalendarInstance>
     */
    private static function flatten(array $sources): array
    {
        return [...$sources['personal'], ...$sources['team']];
    }

    private function logIfSlow(int|float $startedAt, int $sources, int $objects, int $periods): void
    {
        $elapsedMs = (int) round((hrtime(true) - $startedAt) / 1_000_000);
        if ($elapsedMs > self::SLOW_CALL_MS) {
            Log::info('calendar.availability.slow', [
                'ms' => $elapsedMs,
                'sources' => $sources,
                'objects' => $objects,
                'periods' => $periods,
            ]);
        }
    }
}

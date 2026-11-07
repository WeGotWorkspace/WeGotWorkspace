<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

/**
 * A person's busy periods over the requested weeks. `complete` is false when
 * any week is: some busy time could not be worked out, so a gap is not proof
 * of free time.
 *
 * @phpstan-type Period array{
 *     start: string,
 *     timeZone: string|null,
 *     duration: string,
 *     showWithoutTime: bool,
 *     title?: string,
 *     location?: string
 * }
 */
final readonly class AvailabilityResult
{
    /**
     * @param  list<array{period: Period, utcStart: int, utcEnd: int}>  $entries  sorted by start
     * @param  array<int, bool>  $completeByWeek  week start (Unix seconds) => complete
     */
    public function __construct(
        public array $entries,
        public array $completeByWeek,
    ) {}

    public function complete(): bool
    {
        return ! in_array(false, $this->completeByWeek, true);
    }

    /**
     * @return list<Period>
     */
    public function periods(): array
    {
        return array_map(static fn (array $entry): array => $entry['period'], $this->entries);
    }
}

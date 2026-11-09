<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

use App\Models\CalendarInstance;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Support\Facades\Cache;

/**
 * One entry per (owner, UTC week, fingerprint) in the dedicated
 * `availability` cache store, holding the week's unredacted occurrences and
 * its `complete` flag. Viewer-independent: include, dedupe, exclusion and
 * detail are applied after the read.
 *
 * The fingerprint is every eligible source calendar id with its synctoken
 * (Sabre bumps it on every write path) plus a short hash of the app key, so a
 * write or a key rotation is a miss, never a stale hit.
 *
 * @phpstan-import-type Occurrence from AvailabilityOccurrenceReader
 *
 * @phpstan-type WeekEntry array{occurrences: list<Occurrence>, complete: bool}
 */
final class AvailabilityWeekCache
{
    public const STORE = 'availability';

    public const TTL_SECONDS = 300;

    /**
     * @param  list<CalendarInstance>  $sources
     */
    public function fingerprint(array $sources): string
    {
        $tokens = [];
        foreach ($sources as $instance) {
            $tokens[(int) $instance->calendarid] = (int) ($instance->calendar->synctoken ?? 0);
        }
        ksort($tokens);

        return substr(hash('sha256', json_encode($tokens, JSON_THROW_ON_ERROR).'|'.$this->appKeyId()), 0, 32);
    }

    /**
     * @return WeekEntry|null
     */
    public function get(string $owner, int $weekStart, string $fingerprint): ?array
    {
        $entry = $this->store()->get($this->key($owner, $weekStart, $fingerprint));
        if (! is_array($entry) || ! is_array($entry['occurrences'] ?? null) || ! is_bool($entry['complete'] ?? null)) {
            return null;
        }

        $occurrences = [];
        foreach ($entry['occurrences'] as $stored) {
            $occurrence = is_array($stored) ? self::occurrence($stored) : null;
            if ($occurrence === null) {
                return null;
            }
            $occurrences[] = $occurrence;
        }

        return ['occurrences' => $occurrences, 'complete' => $entry['complete']];
    }

    /**
     * Re-types one stored occurrence; anything unexpected is a miss.
     *
     * @param  array<mixed>  $stored
     * @return Occurrence|null
     */
    private static function occurrence(array $stored): ?array
    {
        $string = static fn (string $key): ?string => is_string($stored[$key] ?? null) ? $stored[$key] : null;
        $int = static fn (string $key): ?int => is_int($stored[$key] ?? null) ? $stored[$key] : null;
        $calendarId = $int('calendarId');
        $kind = $string('kind');
        $uid = $string('uid');
        $start = $string('start');
        $duration = $string('duration');
        $utcStart = $int('utcStart');
        $utcEnd = $int('utcEnd');
        if ($calendarId === null || $kind === null || $uid === null || $start === null || $duration === null
            || $utcStart === null || $utcEnd === null
            || ! is_bool($stored['private'] ?? null) || ! is_bool($stored['showWithoutTime'] ?? null)) {
            return null;
        }

        return [
            'calendarId' => $calendarId,
            'kind' => $kind,
            'private' => $stored['private'],
            'title' => $string('title'),
            'location' => $string('location'),
            'uid' => $uid,
            'start' => $start,
            'timeZone' => $string('timeZone'),
            'duration' => $duration,
            'showWithoutTime' => $stored['showWithoutTime'],
            'utcStart' => $utcStart,
            'utcEnd' => $utcEnd,
        ];
    }

    /**
     * @param  WeekEntry  $entry
     */
    public function put(string $owner, int $weekStart, string $fingerprint, array $entry): void
    {
        $this->store()->put($this->key($owner, $weekStart, $fingerprint), $entry, self::TTL_SECONDS);
    }

    /** HMAC of an event UID under the app key: never the raw UID. */
    public function uidHmac(string $uid): string
    {
        return hash_hmac('sha256', $uid, 'availability-uid|'.$this->appKey());
    }

    private function key(string $owner, int $weekStart, string $fingerprint): string
    {
        return 'availability:'.hash('sha256', $owner).':'.$weekStart.':'.$fingerprint;
    }

    private function appKeyId(): string
    {
        return substr(hash('sha256', 'availability-key|'.$this->appKey()), 0, 12);
    }

    private function appKey(): string
    {
        $key = config('app.key');

        return is_string($key) ? $key : '';
    }

    private function store(): Repository
    {
        return Cache::store(self::STORE);
    }
}

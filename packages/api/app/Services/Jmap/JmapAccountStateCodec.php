<?php

declare(strict_types=1);

namespace App\Services\Jmap;

/**
 * Envelope-owned account-wide state codec (spec §4, mismatch 13).
 *
 * Unlike CalendarEventRepository::composeCalendarState() (which collapses a
 * single calendar to its bare synctoken) and CalendarRepository's
 * parseInstancesState() (which rejects the zero-calendar "0:" form), this
 * codec is always count-prefixed and round-trips the empty, single, and
 * multi-calendar cases: decompose(compose($map)) === $map for every map.
 */
final class JmapAccountStateCodec
{
    /**
     * Composes `{count}:{uri}:{token},...` sorted by calendar uri.
     * Zero calendars compose to `"0:"`.
     *
     * @param  array<string, string>  $tokensByUri
     */
    public static function compose(array $tokensByUri): string
    {
        ksort($tokensByUri);
        $parts = [];
        foreach ($tokensByUri as $uri => $token) {
            $parts[] = $uri.':'.$token;
        }

        return count($parts).':'.implode(',', $parts);
    }

    /**
     * Strict inverse of compose(). Accepts `"0:"`, `"0"`, and `""` as the
     * empty map (the initial-sync forms the REST layer also honours);
     * returns null for anything malformed.
     *
     * @return array<string, string>|null
     */
    public static function decompose(?string $state): ?array
    {
        if ($state === null) {
            return null;
        }
        if ($state === '' || $state === '0' || $state === '0:') {
            return [];
        }
        if (! preg_match('/^(\d+):(.*)$/s', $state, $matches)) {
            return null;
        }
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== (int) $matches[1]) {
            return null;
        }

        $map = [];
        foreach ($entries as $entry) {
            // The synctoken is the segment after the LAST colon, so uris
            // containing colons still round-trip.
            $separator = strrpos($entry, ':');
            if ($separator === false) {
                return null;
            }
            $uri = substr($entry, 0, $separator);
            $token = substr($entry, $separator + 1);
            if ($uri === '' || $token === '' || ! ctype_digit($token)) {
                return null;
            }
            $map[$uri] = $token;
        }

        return $map;
    }
}

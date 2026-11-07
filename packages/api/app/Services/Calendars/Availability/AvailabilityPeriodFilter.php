<?php

declare(strict_types=1);

namespace App\Services\Calendars\Availability;

/**
 * Turns cached, unredacted week entries into what a teammate may see, in this
 * order: the owner's `include` choice, dedupe by (UID HMAC, occurrence start),
 * the excluded event, the detail level of each occurrence's own calendar, and
 * a fixed output field list. Output is built, never copied: no UID, id,
 * description, attendees, organizer, alarms or other properties.
 *
 * @phpstan-import-type Occurrence from AvailabilityOccurrenceReader
 * @phpstan-import-type Period from AvailabilityResult
 */
final class AvailabilityPeriodFilter
{
    public const MAX_TITLE_LENGTH = 200;

    /**
     * @param  array<int, array{occurrences: list<Occurrence>, complete: bool}>  $weeks  week start => entry
     * @param  array<int, array{include: bool, detail: string}>  $prefs
     */
    public function apply(array $weeks, array $prefs, ?string $excludeUidHmac): AvailabilityResult
    {
        /** @var array<string, array{occurrence: Occurrence, details: bool}> $chosen */
        $chosen = [];
        $completeByWeek = [];
        foreach ($weeks as $weekStart => $week) {
            $completeByWeek[$weekStart] = $week['complete'];
            foreach ($week['occurrences'] as $occurrence) {
                $calendarId = $occurrence['calendarId'];
                if (! AvailabilitySettings::includes($prefs, $calendarId)
                    || ($excludeUidHmac !== null && hash_equals($occurrence['uid'], $excludeUidHmac))) {
                    continue;
                }
                $details = $occurrence['kind'] === AvailabilityOccurrenceReader::KIND_PERSONAL
                    && AvailabilitySettings::detail($prefs, $calendarId) === AvailabilitySettings::DETAIL_DETAILS
                    && ! $occurrence['private'];
                $key = $occurrence['uid'].'|'.$occurrence['utcStart'];
                // A Team copy or a time-only copy is never beaten by a details copy.
                if (! isset($chosen[$key]) || ($chosen[$key]['details'] && ! $details)) {
                    $chosen[$key] = ['occurrence' => $occurrence, 'details' => $details];
                }
            }
        }

        $entries = array_map(fn (array $pick): array => [
            'period' => $this->period($pick['occurrence'], $pick['details']),
            'utcStart' => $pick['occurrence']['utcStart'],
            'utcEnd' => $pick['occurrence']['utcEnd'],
        ], array_values($chosen));
        usort($entries, static fn (array $a, array $b): int => [$a['utcStart'], $a['utcEnd']] <=> [$b['utcStart'], $b['utcEnd']]);
        ksort($completeByWeek);

        return new AvailabilityResult($entries, $completeByWeek);
    }

    /**
     * @param  Occurrence  $occurrence
     * @return Period
     */
    private function period(array $occurrence, bool $details): array
    {
        $period = [
            'start' => $occurrence['start'],
            'timeZone' => $occurrence['timeZone'],
            'duration' => $occurrence['duration'],
            'showWithoutTime' => $occurrence['showWithoutTime'],
        ];
        if (! $details) {
            return $period;
        }
        if ($occurrence['title'] !== null) {
            $period['title'] = mb_substr($occurrence['title'], 0, self::MAX_TITLE_LENGTH);
        }
        // Meeting links never leak: a location that is or holds a URL is dropped.
        if ($occurrence['location'] !== null && preg_match('#[a-z][a-z0-9+.\-]*://#i', $occurrence['location']) !== 1) {
            $period['location'] = $occurrence['location'];
        }

        return $period;
    }
}

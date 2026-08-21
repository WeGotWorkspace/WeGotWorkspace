<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\VObject\ICalendarDateTime;

/**
 * Builds the CalendarEvent patch for an invitee RSVP, including per-occurrence
 * (this) and this-and-future (future) scope on a repeating series.
 */
final class CalendarSchedulingRsvpScope
{
    public function __construct(
        private readonly CalendarEventExpansionService $expansion,
    ) {}

    /**
     * @param  array<string, mixed>  $event
     * @param  callable(mixed): bool  $isOwnParticipant
     * @return array<string, mixed>
     */
    public function patch(
        array $event,
        string $status,
        ?string $scope,
        ?string $recurrenceId,
        ?string $calendarId,
        callable $isOwnParticipant,
        ?string $ics = null,
    ): array {
        $participants = is_array($event['participants'] ?? null) ? $event['participants'] : [];
        $updatedParticipants = $this->withOwnPartstat($participants, $status, $isOwnParticipant);

        $patch = [];
        if (is_string($calendarId) && $calendarId !== '' && in_array($status, ['accepted', 'tentative'], true)) {
            $patch['calendarIds'] = [$calendarId => true];
        }

        $recurring = $this->expansion->isRecurring($event);
        $normalizedId = is_string($recurrenceId) && $recurrenceId !== ''
            ? $this->normalizeRecurrenceId($recurrenceId, $event)
            : $this->seriesStartId($event);

        if (! $recurring) {
            $patch['participants'] = $updatedParticipants;

            return $patch;
        }

        // Sidebar / first RSVP (no scope) is series-wide: stamp the master and
        // any leftover RECURRENCE-ID participant overrides so instances cannot
        // keep ACCEPTED/NEEDS-ACTION after a series decline.
        if ($scope === null || $scope === '') {
            $patch['participants'] = $updatedParticipants;
            $overrides = $this->withOwnPartstatOnExistingOverrides(
                $event,
                $status,
                $isOwnParticipant,
            );
            if ($overrides !== null) {
                $patch['recurrenceOverrides'] = $overrides;
            }

            return $patch;
        }

        if ($scope === 'this') {
            $targetId = $normalizedId ?? $this->seriesStartId($event);
            if ($targetId === null || $targetId === '') {
                $patch['participants'] = $updatedParticipants;

                return $patch;
            }

            $overrides = $this->existingOverrides($event);
            $existing = is_array($overrides[$targetId] ?? null) ? $overrides[$targetId] : [];
            $baseParticipants = is_array($existing['participants'] ?? null)
                ? $existing['participants']
                : $participants;
            $existing['participants'] = $this->withOwnPartstat($baseParticipants, $status, $isOwnParticipant);
            $overrides[$targetId] = $existing;
            $patch['recurrenceOverrides'] = $overrides;

            return $patch;
        }

        // scope=future: new PARTSTAT is the series default from this instance on.
        $patch['participants'] = $updatedParticipants;
        $splitId = $normalizedId ?? $this->seriesStartId($event);
        if ($splitId === null || $splitId === '' || $this->isSeriesStart($event, $splitId)) {
            return $patch;
        }

        $overrides = $this->existingOverrides($event);
        foreach ($this->pastRecurrenceIds($event, $ics, $splitId) as $pastId) {
            $existing = is_array($overrides[$pastId] ?? null) ? $overrides[$pastId] : [];
            $baseParticipants = is_array($existing['participants'] ?? null)
                ? $existing['participants']
                : $participants;
            $existing['participants'] = $this->withOwnPartstat(
                $baseParticipants,
                $this->ownPartstat($baseParticipants, $isOwnParticipant),
                $isOwnParticipant,
            );
            $overrides[$pastId] = $existing;
        }
        if ($overrides !== []) {
            $patch['recurrenceOverrides'] = $overrides;
        }

        return $patch;
    }

    /**
     * @param  array<string, mixed>  $participants
     * @param  callable(mixed): bool  $isOwnParticipant
     * @return array<string, mixed>
     */
    public function withOwnPartstat(array $participants, string $status, callable $isOwnParticipant): array
    {
        $updated = false;
        foreach ($participants as $id => $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if (! $isOwnParticipant($participant['email'] ?? null)) {
                continue;
            }
            $participant['participationStatus'] = $status;
            $participants[$id] = $participant;
            $updated = true;
        }
        if (! $updated) {
            return $participants;
        }

        return $participants;
    }

    /**
     * @param  array<string, mixed>  $participants
     * @param  callable(mixed): bool  $isOwnParticipant
     */
    public function ownPartstat(array $participants, callable $isOwnParticipant): string
    {
        foreach ($participants as $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if (! $isOwnParticipant($participant['email'] ?? null)) {
                continue;
            }
            $status = strtolower(trim((string) ($participant['participationStatus'] ?? 'needs-action')));

            return $status !== '' ? $status : 'needs-action';
        }

        return 'needs-action';
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public function normalizeRecurrenceId(string $recurrenceId, array $event): string
    {
        $normalized = ICalendarDateTime::toJmap($recurrenceId);
        $start = $this->seriesStartId($event);
        if ($start !== null && $this->sameRecurrenceInstant($normalized, $start)) {
            return $start;
        }

        return $normalized;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    public function isSeriesStart(array $event, string $recurrenceId): bool
    {
        $start = $this->seriesStartId($event);

        return $start !== null && $this->sameRecurrenceInstant($recurrenceId, $start);
    }

    /**
     * Rewrite own PARTSTAT on instance exceptions that already carry participants.
     * Timing-only / RDATE patches are left untouched so they inherit the master.
     *
     * @param  array<string, mixed>  $event
     * @param  callable(mixed): bool  $isOwnParticipant
     * @return array<string, array<string, mixed>>|null
     */
    private function withOwnPartstatOnExistingOverrides(
        array $event,
        string $status,
        callable $isOwnParticipant,
    ): ?array {
        $overrides = $this->existingOverrides($event);
        if ($overrides === []) {
            return null;
        }

        $changed = false;
        foreach ($overrides as $id => $existing) {
            if (($existing['excluded'] ?? false) === true) {
                continue;
            }
            $baseParticipants = is_array($existing['participants'] ?? null)
                ? $existing['participants']
                : null;
            if ($baseParticipants === null) {
                continue;
            }
            $existing['participants'] = $this->withOwnPartstat(
                $baseParticipants,
                $status,
                $isOwnParticipant,
            );
            $overrides[$id] = $existing;
            $changed = true;
        }

        return $changed ? $overrides : null;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return array<string, array<string, mixed>>
     */
    private function existingOverrides(array $event): array
    {
        $overrides = $event['recurrenceOverrides'] ?? null;
        if (! is_array($overrides)) {
            return [];
        }
        $kept = [];
        foreach ($overrides as $id => $patch) {
            if (is_string($id) && $id !== '' && is_array($patch)) {
                $kept[$id] = $patch;
            }
        }

        return $kept;
    }

    /**
     * @param  array<string, mixed>  $event
     * @return list<string>
     */
    private function pastRecurrenceIds(array $event, ?string $ics, string $splitId): array
    {
        if (! is_string($ics) || $ics === '') {
            return [];
        }
        $start = $this->seriesStartId($event);
        if ($start === null || $start === '') {
            return [];
        }

        $instances = $this->expansion->expandInWindow($event, $ics, 'default', $start, $splitId);
        $ids = [];
        foreach ($instances as $instance) {
            $rid = $instance['recurrenceId'] ?? null;
            if (! is_string($rid) || $rid === '') {
                continue;
            }
            if ($this->sameRecurrenceInstant($rid, $splitId)) {
                continue;
            }
            $ids[] = $rid;
        }

        return $ids;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function seriesStartId(array $event): ?string
    {
        $start = $event['start'] ?? null;

        return is_string($start) && $start !== '' ? $start : null;
    }

    private function sameRecurrenceInstant(string $left, string $right): bool
    {
        return ICalendarDateTime::toIcs($left) === ICalendarDateTime::toIcs($right);
    }
}

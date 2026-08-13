<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\JmapCalendarEventStateService;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * Account-wide CalendarEvent/changes fan-out (spec §4): sinceState is
 * decomposed with the envelope codec into per-calendar sync tokens, then
 * per calendar —
 *  - not in sinceState (newly visible): every current event is `created`;
 *  - token changed: the existing per-calendar changes() delta is merged;
 *  - token unchanged: skipped;
 *  - in sinceState but gone now: every event id previously recorded for
 *    that calendar is `destroyed`.
 *
 * hasMoreChanges is always false — the same honest limitation as the REST
 * per-calendar /changes (Sabre's change log cannot produce a safe
 * intermediate token), so maxChanges is validated but never truncates.
 */
final class CalendarEventChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(
        private readonly CalendarEventRepository $events,
        private readonly JmapCalendarEventStateService $states,
    ) {}

    public function name(): string
    {
        return 'CalendarEvent/changes';
    }

    public function capability(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $sinceState = $this->sinceState($args);
        $since = JmapAccountStateCodec::decompose($sinceState);
        if ($since === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        $current = $this->events->calendarSyncTokens($username);

        $created = [];
        $updated = [];
        $destroyed = [];
        foreach ($current as $uri => $token) {
            if (! array_key_exists($uri, $since)) {
                // Newly visible calendar: all its current events are created.
                $delta = $this->events->changes($username, $uri, null);
                array_push($created, ...$delta['created']);

                continue;
            }
            if ($since[$uri] !== $token) {
                $delta = $this->events->changes($username, $uri, $since[$uri]);
                array_push($created, ...$delta['created']);
                array_push($updated, ...$delta['updated']);
                array_push($destroyed, ...$delta['destroyed']);
            }
        }

        foreach (array_keys($since) as $uri) {
            if (! array_key_exists($uri, $current)) {
                // Calendar deleted or no longer visible: every id ever
                // surfaced for it is destroyed.
                array_push($destroyed, ...$this->states->recordedEventIdsForCalendar($username, $uri));
            }
        }

        // An id may only appear in one list (RFC 8620 §5.2): created wins,
        // then updated; ids that exist now are never reported destroyed.
        $created = array_values(array_unique($created));
        $updated = array_values(array_diff(array_unique($updated), $created));
        $destroyed = array_values(array_diff(array_unique($destroyed), $created, $updated));

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => JmapAccountStateCodec::compose($current),
            'hasMoreChanges' => false,
            'created' => $created,
            'updated' => $updated,
            'destroyed' => $destroyed,
        ];
    }
}

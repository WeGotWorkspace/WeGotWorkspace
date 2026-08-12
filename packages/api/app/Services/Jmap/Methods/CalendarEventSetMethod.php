<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarEventSetService;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\ValidatesSetArguments;

/**
 * CalendarEvent/set over the existing CalendarEventSetService (unmodified —
 * its per-record ifInState stays exclusive to the legacy REST endpoint).
 *
 * The envelope implements genuine RFC 8620 §5.3 top-level ifInState
 * independently: compared against the envelope-codec account state BEFORE
 * the service runs; mismatch means nothing is mutated (spec §5). On success
 * the per-item created/updated/destroyed/not* shapes pass through verbatim,
 * but top-level oldState/newState are REPLACED with account-wide envelope
 * states — the service's own values are touched-calendar-scoped and
 * collapse single calendars to a bare token, which the client would later
 * replay as an undecomposable sinceState (mismatch 13).
 */
final class CalendarEventSetMethod implements JmapMethodInterface
{
    use ValidatesSetArguments;

    public function __construct(
        private readonly CalendarEventRepository $events,
        private readonly CalendarEventSetService $set,
    ) {}

    public function name(): string
    {
        return 'CalendarEvent/set';
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
        $oldState = JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username));
        $this->guardIfInState($args, $oldState);
        [$create, $update, $destroy] = $this->setOperations($args);

        $result = $this->set->set($username, [
            'create' => $create,
            'update' => $update,
            'destroy' => $destroy,
        ]);

        $result['oldState'] = $oldState;
        $result['newState'] = JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username));

        return ['accountId' => $username] + $result;
    }
}

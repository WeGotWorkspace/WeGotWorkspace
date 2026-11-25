<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\JmapCalendarEventStateService;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;
use App\Services\VObject\VObjectPayloadGuard;
use Illuminate\Support\Facades\Log;

/**
 * CalendarEvent/get: no multi-id repository method exists, so the loop
 * over CalendarEventRepository::show() lives here (spec dispatch table).
 * With args.ids null, all owned VEVENT calendars are enumerated via
 * calendarSyncTokens() and listed per calendar. State is composed with the
 * envelope codec — NOT composeCalendarState(), whose single-calendar output
 * is not decomposable (spec §4).
 */
final class CalendarEventGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    /** Events loaded per lookup, so a large get never holds every row at once. */
    private const GET_CHUNK = 100;

    public function __construct(
        private readonly CalendarEventRepository $events,
        private readonly JmapCalendarEventStateService $eventStates,
    ) {}

    public static function name(): string
    {
        return 'CalendarEvent/get';
    }

    public static function capability(): string
    {
        return JmapCapabilities::CALENDARS;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        Log::withContext(['principal' => $username]);

        $tokens = $this->events->calendarSyncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $projection = $this->getProjection($args);
        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $calendarUri) {
                foreach ($this->events->list($username, $calendarUri)['list'] as $event) {
                    $list[] = $projection->apply($event);
                }
            }
            $this->guardGetAllBound($list);
        } else {
            // Chunked, so the located calendar rows (raw iCalendar) of a page are not all held at once.
            foreach (array_chunk($ids, self::GET_CHUNK) as $chunk) {
                $locate = $this->events->ownedEventLocator($username, $chunk);
                $states = $this->eventStates->statesFor($username, $chunk);
                foreach ($chunk as $id) {
                    try {
                        $list[] = $projection->apply($this->events->show($username, $id, $locate, $states));
                    } catch (ApiHttpException $e) {
                        if ($e->getStatusCode() === 404 || VObjectPayloadGuard::isPayloadBoundError($e)) {
                            $notFound[] = $id;

                            continue;
                        }
                        throw $e;
                    }
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $list,
            'notFound' => $notFound,
        ];
    }
}

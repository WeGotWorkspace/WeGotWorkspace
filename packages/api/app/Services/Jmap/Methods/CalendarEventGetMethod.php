<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Exceptions\ApiHttpException;
use App\Services\Calendars\CalendarEventRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

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

    public function __construct(private readonly CalendarEventRepository $events) {}

    public function name(): string
    {
        return 'CalendarEvent/get';
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
        $tokens = $this->events->calendarSyncTokens($username);
        $state = JmapAccountStateCodec::compose($tokens);

        $ids = $this->requestedIds($args);
        $list = [];
        $notFound = [];
        if ($ids === null) {
            foreach (array_keys($tokens) as $calendarUri) {
                foreach ($this->events->list($username, $calendarUri)['list'] as $event) {
                    $list[] = $event;
                }
            }
            $this->guardGetAllBound($list);
        } else {
            foreach ($ids as $id) {
                try {
                    $list[] = $this->events->show($username, $id);
                } catch (ApiHttpException $e) {
                    if ($e->getStatusCode() === 404) {
                        $notFound[] = $id;

                        continue;
                    }
                    throw $e;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $state,
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}

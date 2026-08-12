<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Calendars\CalendarRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;

/**
 * Calendar/get: the existing CalendarRepository::list(), filtered to
 * args.ids when given, wrapped in the RFC 8620 §5.1 GetResponse shape with
 * envelope-codec state and the 8-property myRights mapping (spec §6).
 */
final class CalendarGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(
        private readonly CalendarRepository $calendars,
        private readonly CalendarEventRepository $events,
    ) {}

    public function name(): string
    {
        return 'Calendar/get';
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
        $state = JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username));
        $all = array_map(
            CalendarRightsMapper::remap(...),
            $this->calendars->list($username)['list'],
        );

        $ids = $this->requestedIds($args);
        $notFound = [];
        if ($ids === null) {
            $list = $all;
        } else {
            $byId = [];
            foreach ($all as $calendar) {
                $byId[(string) $calendar['id']] = $calendar;
            }
            $list = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
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

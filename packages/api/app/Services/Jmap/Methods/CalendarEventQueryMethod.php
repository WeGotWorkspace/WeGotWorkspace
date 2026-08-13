<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;

/**
 * CalendarEvent/query over the existing CalendarEventRepository::query().
 *
 * filter.inCalendars is injected (all owned VEVENT calendar uris) when the
 * client omits it BEFORE calling the repository — the shipped adapter's
 * loadRange() never sends it, and the 400 lives inside
 * resolveQueryCalendars(), not only in the REST FormRequest (spec §3).
 * queryState is recomposed account-wide with the envelope codec.
 */
final class CalendarEventQueryMethod implements JmapMethodInterface
{
    public function __construct(private readonly CalendarEventRepository $events) {}

    public function name(): string
    {
        return 'CalendarEvent/query';
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
        $filter = $args['filter'] ?? [];
        if ($filter === null) {
            $filter = [];
        }
        if (! is_array($filter) || ($filter !== [] && array_is_list($filter))) {
            throw new JmapMethodException('invalidArguments', 'filter must be null or a FilterCondition object.');
        }

        $sort = $args['sort'] ?? [];
        if ($sort === null) {
            $sort = [];
        }
        if (! is_array($sort) || ! array_is_list($sort)) {
            throw new JmapMethodException('invalidArguments', 'sort must be null or an array of comparators.');
        }

        $position = $args['position'] ?? 0;
        if (! is_int($position) || $position < 0) {
            throw new JmapMethodException('invalidArguments', 'position must be a non-negative integer.');
        }

        $limit = $args['limit'] ?? null;
        if ($limit !== null && (! is_int($limit) || $limit < 1)) {
            throw new JmapMethodException('invalidArguments', 'limit must be null or a positive integer.');
        }

        $tokens = $this->events->calendarSyncTokens($username);
        $queryState = JmapAccountStateCodec::compose($tokens);

        $inCalendars = $filter['inCalendars'] ?? null;
        if ($inCalendars === []) {
            // An explicit empty selection matches nothing.
            return $this->response($username, $queryState, [], $position, 0, $limit);
        }
        if (! is_array($inCalendars)) {
            if ($tokens === []) {
                return $this->response($username, $queryState, [], $position, 0, $limit);
            }
            $filter['inCalendars'] = array_keys($tokens);
        }

        $result = $this->events->query($username, $filter, $sort, $position, $limit);

        return $this->response(
            $username,
            $queryState,
            $result['ids'],
            $result['position'],
            $result['total'],
            $limit,
        );
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, mixed>
     */
    private function response(
        string $username,
        string $queryState,
        array $ids,
        int $position,
        int $total,
        ?int $limit,
    ): array {
        $response = [
            'accountId' => $username,
            'queryState' => $queryState,
            'canCalculateChanges' => false,
            'position' => $position,
            'ids' => $ids,
            'total' => $total,
        ];
        if ($limit !== null) {
            $response['limit'] = $limit;
        }

        return $response;
    }
}

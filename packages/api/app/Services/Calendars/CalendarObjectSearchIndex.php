<?php

declare(strict_types=1);

namespace App\Services\Calendars;

use App\Services\Search\BestEffortSearchIndexSync;
use App\Services\Search\SearchIndexerService;

/**
 * Keeps the search index in step with one calendar object written or removed
 * outside the DAV server (scheduling delivery, inbound iMIP replies).
 * Best effort: a failed index write never fails the calendar write.
 */
final class CalendarObjectSearchIndex
{
    public function __construct(
        private readonly SearchIndexerService $searchIndexer,
        private readonly BestEffortSearchIndexSync $searchIndexSync,
    ) {}

    /**
     * @return array{username: string, davPath: string}
     */
    public static function davPath(string $principalUri, string $calendarUri, string $eventUri): array
    {
        $username = str_starts_with($principalUri, 'principals/')
            ? substr($principalUri, strlen('principals/'))
            : $principalUri;

        return ['username' => $username, 'davPath' => 'calendars/'.$username.'/'.$calendarUri.'/'.$eventUri];
    }

    public function index(string $principalUri, string $calendarUri, string $eventUri): void
    {
        ['username' => $username, 'davPath' => $davPath] = self::davPath($principalUri, $calendarUri, $eventUri);
        $this->searchIndexSync->sync(
            'calendars',
            fn () => $this->searchIndexer->indexCalendarObjectFromPath($davPath),
            $davPath,
            $username,
        );
    }

    public function remove(string $principalUri, string $calendarUri, string $eventUri): void
    {
        ['username' => $username, 'davPath' => $davPath] = self::davPath($principalUri, $calendarUri, $eventUri);
        $this->searchIndexSync->sync(
            'calendars',
            fn () => $this->searchIndexer->deleteDavPath($davPath),
            $davPath,
            $username,
        );
    }
}

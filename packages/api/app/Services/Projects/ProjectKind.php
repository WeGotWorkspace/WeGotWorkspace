<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CollectionKind;

/**
 * The five things a Project bundles (#817), one of each at most.
 * The value is stored in `project_resources.kind`.
 */
enum ProjectKind: string
{
    case Calendar = 'calendar';
    case TaskList = 'tasklist';
    case Notebook = 'notebook';
    case Channel = 'meet_channel';
    case DriveFolder = 'drive_folder';

    /** @return list<self> the four CalDAV-backed kinds, in the order create makes them */
    public static function collections(): array
    {
        return [self::Calendar, self::TaskList, self::Notebook, self::Channel];
    }

    public function collectionKind(): CollectionKind
    {
        return match ($this) {
            self::Calendar => CollectionKind::EventCalendar,
            self::TaskList => CollectionKind::TaskList,
            self::Notebook => CollectionKind::Notebook,
            self::Channel => CollectionKind::ChatChannel,
            self::DriveFolder => throw new \LogicException('A Drive folder is not a CalDAV collection.'),
        };
    }

    /** @return list<string> */
    public function components(): array
    {
        return match ($this) {
            self::Calendar => ['VEVENT'],
            self::TaskList => ['VTODO'],
            self::Notebook, self::Channel => ['VJOURNAL'],
            self::DriveFolder => [],
        };
    }

    /** Whether the collection carries a color the Project writes through. Channels have none. */
    public function hasColor(): bool
    {
        return in_array($this, [self::Calendar, self::TaskList, self::Notebook], true);
    }

    /** The response key of this item's id. */
    public function responseKey(): string
    {
        return match ($this) {
            self::Calendar => 'calendarId',
            self::TaskList => 'taskListId',
            self::Notebook => 'notebookId',
            self::Channel => 'channelId',
            self::DriveFolder => 'driveFolderId',
        };
    }

    /**
     * The API id the app uses for a Team-owned collection of this kind: the Team's
     * provisioned collections have a `group-` id, every other one its uri.
     */
    public function apiId(string $groupSlug, string $uri): string
    {
        return match (true) {
            $this === self::Calendar && $uri === CalendarCollectionUris::groupCalendarCalDavUri($groupSlug) => CalendarCollectionUris::groupCalendarApiId($groupSlug),
            $this === self::TaskList && $uri === CalendarCollectionUris::groupTaskListCalDavUri($groupSlug) => CalendarCollectionUris::groupTaskListApiId($groupSlug),
            $this === self::Notebook && $uri === CalendarCollectionUris::groupNotebookCalDavUri($groupSlug) => CalendarCollectionUris::groupNotebookApiId($groupSlug),
            default => $uri,
        };
    }
}

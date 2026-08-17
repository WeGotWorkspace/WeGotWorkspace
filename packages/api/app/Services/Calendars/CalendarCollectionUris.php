<?php

declare(strict_types=1);

namespace App\Services\Calendars;

/**
 * Canonical CalDAV collection URIs for strict VEVENT vs VTODO separation.
 *
 * VEVENT calendars and VTODO task lists share display names (Home, Work) but use different URIs.
 */
final class CalendarCollectionUris
{
    public const EVENT_DEFAULT = 'default';

    public const EVENT_HOME = 'home';

    public const EVENT_WORK = 'work';

    public const TASK_INBOX = 'inbox';

    public const TASK_HOME = 'tasks-home';

    public const TASK_WORK = 'tasks-work';

    /** @return list<string> */
    public static function reservedEventUris(): array
    {
        return [self::EVENT_DEFAULT, self::EVENT_HOME, self::EVENT_WORK];
    }

    /** @return list<string> */
    public static function reservedTaskUris(): array
    {
        return [self::TASK_INBOX, self::TASK_HOME, self::TASK_WORK];
    }

    /** @return list<string> */
    public static function reservedTaskUriSlugs(): array
    {
        return array_merge(self::reservedTaskUris(), self::reservedEventUris());
    }

    public static function groupTaskListCalDavUri(string $groupSlug): string
    {
        return 'tasks-'.$groupSlug;
    }

    public static function groupTaskListApiId(string $groupSlug): string
    {
        return 'group-'.$groupSlug;
    }

    public static function parseGroupTaskListApiId(string $taskListId): ?string
    {
        return self::parseGroupCollectionApiId($taskListId);
    }

    /**
     * Provisioned group VEVENT collection URI is the group slug (see UserCalendarCollectionsProvisioner).
     */
    public static function groupCalendarCalDavUri(string $groupSlug): string
    {
        return $groupSlug;
    }

    public static function groupCalendarApiId(string $groupSlug): string
    {
        return 'group-'.$groupSlug;
    }

    public static function parseGroupCalendarApiId(string $calendarId): ?string
    {
        return self::parseGroupCollectionApiId($calendarId);
    }

    public static function parseGroupCollectionApiId(string $id): ?string
    {
        if (preg_match('#^group-([A-Za-z0-9._-]{1,190})$#', $id, $matches) !== 1) {
            return null;
        }

        return $matches[1];
    }
}

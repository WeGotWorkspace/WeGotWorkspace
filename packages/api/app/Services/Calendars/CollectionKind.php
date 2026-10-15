<?php

declare(strict_types=1);

namespace App\Services\Calendars;

/**
 * Which app owns a CalDAV collection.
 *
 * Stored once per calendarid in `calendar_collection_meta` and never derived
 * from the collection uri at runtime: Sabre mints a random UUID uri for every
 * sharee instance, so the uri does not identify a collection across instances.
 * The component set is not a substitute either — it can change after creation
 * (DefaultMixedCalendarMigrator rewrites it).
 */
enum CollectionKind: string
{
    case EventCalendar = 'event_calendar';
    case TaskList = 'task_list';
    case Notebook = 'notebook';
    case ChatChannel = 'chat_channel';
    case DocsThreadPool = 'docs_thread_pool';

    /** Families that never surface over WebDAV. Notes stay visible by design. */
    public function davHidden(): bool
    {
        return in_array($this, [self::ChatChannel, self::DocsThreadPool], true);
    }

    /** Guard against a kind being stored on a collection that cannot hold its data. */
    public function allowsComponents(string $components): bool
    {
        $hasEvent = str_contains($components, 'VEVENT');
        $hasTodo = str_contains($components, 'VTODO');
        $hasJournal = str_contains($components, 'VJOURNAL');

        return match ($this) {
            self::EventCalendar => $hasEvent,
            self::TaskList => $hasTodo && ! $hasEvent,
            self::Notebook, self::ChatChannel, self::DocsThreadPool => $hasJournal && ! $hasEvent && ! $hasTodo,
        };
    }

    /**
     * Kind for a collection created over DAV (MKCALENDAR), which states no kind.
     * This is the only place a kind is ever derived. A VJOURNAL-only collection
     * made by an external journal client is a notebook — that interop is
     * deliberate (see ChatCollectionsDavExposureTest).
     */
    public static function fromComponents(string $components): self
    {
        if (str_contains($components, 'VEVENT')) {
            return self::EventCalendar;
        }
        if (str_contains($components, 'VTODO')) {
            return self::TaskList;
        }

        return self::Notebook;
    }
}

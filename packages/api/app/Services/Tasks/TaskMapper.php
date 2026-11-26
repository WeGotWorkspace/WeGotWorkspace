<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Http\Support\OptimisticConcurrency;
use App\Models\CalendarObject;
use App\Services\Tasks\Conversion\ConversionSupport;
use App\Services\Tasks\Conversion\IcsJmapTaskConverter;
use Illuminate\Support\Str;

final class TaskMapper
{
    /** Whose view participants are read in; null maps nobody to an account. */
    private ?string $viewer = null;

    public function __construct(
        private readonly TaskParticipantDirectory $participants,
        private readonly IcsJmapTaskConverter $converter = new IcsJmapTaskConverter,
    ) {}

    /**
     * A mapper that reads participants as `$viewer` may see them (#2172).
     */
    public function forViewer(string $viewer): self
    {
        $mapper = clone $this;
        $mapper->viewer = $viewer;

        return $mapper;
    }

    /**
     * The fields of a list row (the lean first download, Epic #2284): what a
     * list shows and sorts by, without the heavy parts (description, assignees,
     * reminders, per-instance overrides, unmapped properties). A client that
     * leaves a field out treats it as unknown, never as empty.
     */
    public const LIST_FIELDS = [
        '@type', 'id', 'taskListId', 'uid', 'title', 'start', 'due', 'completed',
        'showWithoutTime', 'timeZone', 'workflowStatus', 'progress', 'priority',
        'isDraft', 'sortOrder', 'categories', 'privacy', 'created', 'updated', 'etag',
        'recurrenceRules', 'excludedRecurrenceDates',
    ];

    /**
     * @param  bool  $lean  Only {@see self::LIST_FIELDS}, projected per task; the
     *                      participants are not looked up at all.
     * @return list<array<string, mixed>>
     */
    public function toTasks(CalendarObject $object, string $taskListUri, bool $lean = false): array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $calendarId = (int) $object->calendarid;
        $parsed = $this->converter->tasksFromIcs($raw, (string) $object->uri, $taskListUri);
        $tasks = $lean
            ? $parsed
            : array_map(
                fn (array $task): array => $this->participants->resolveTask($task, $calendarId, $this->viewer),
                $parsed,
            );
        $etag = OptimisticConcurrency::formatEtag(is_string($object->etag) ? $object->etag : null);
        $lastModified = (int) ($object->lastmodified ?? 0);
        if ($lastModified <= 0 && $etag === null) {
            return $lean ? array_map(self::projectListFields(...), $tasks) : $tasks;
        }

        $timestamp = $lastModified > 0 ? gmdate('Y-m-d\TH:i:s\Z', $lastModified) : null;

        return array_map(function (array $task) use ($timestamp, $etag, $lean): array {
            if ($etag !== null) {
                $task['etag'] = $etag;
            }
            if ($timestamp !== null) {
                if (! isset($task['updated']) || ! is_string($task['updated']) || $task['updated'] === '') {
                    $task['updated'] = $timestamp;
                }
                if (! isset($task['created']) || ! is_string($task['created']) || $task['created'] === '') {
                    $task['created'] = $timestamp;
                }
            }

            return $lean ? self::projectListFields($task) : $task;
        }, $tasks);
    }

    /**
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    private static function projectListFields(array $task): array
    {
        return array_intersect_key($task, array_flip(self::LIST_FIELDS));
    }

    /**
     * @return array<string, mixed>|null
     */
    public function toTask(CalendarObject $object, string $taskListUri, ?string $vtodoUid = null): ?array
    {
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $task = $this->converter->taskFromIcsComponent($raw, (string) $object->uri, $taskListUri, $vtodoUid);
        if ($task === null) {
            return null;
        }
        $task = $this->participants->resolveTask($task, (int) $object->calendarid, $this->viewer);

        $etag = OptimisticConcurrency::formatEtag(is_string($object->etag) ? $object->etag : null);
        if ($etag !== null) {
            $task['etag'] = $etag;
        }

        $lastModified = (int) ($object->lastmodified ?? 0);
        if ($lastModified > 0) {
            $timestamp = gmdate('Y-m-d\TH:i:s\Z', $lastModified);
            if (! isset($task['updated']) || ! is_string($task['updated']) || $task['updated'] === '') {
                $task['updated'] = $timestamp;
            }
            if (! isset($task['created']) || ! is_string($task['created']) || $task['created'] === '') {
                $task['created'] = $timestamp;
            }
        }

        return $task;
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function toIcs(array $payload): string
    {
        return $this->converter->icsFromTask($payload);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public function mergeIntoIcs(string $ics, array $payload, ?string $replaceUid = null): string
    {
        return $this->converter->mergeTaskIntoIcs($ics, $payload, $replaceUid);
    }

    public function removeVtodoFromIcs(string $ics, string $vtodoUid): ?string
    {
        return $this->converter->removeVtodoFromIcs($ics, $vtodoUid);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function generateObjectUri(array $payload): string
    {
        $base = ConversionSupport::deriveTitle($payload);
        $slug = strtolower(trim(preg_replace('/[^a-z0-9]+/i', '-', $base) ?? '', '-'));
        if ($slug === '') {
            $slug = 'task';
        }
        $suffix = substr(str_replace('-', '', (string) Str::uuid()), 0, 8);

        return $slug.'-'.$suffix.'.ics';
    }
}

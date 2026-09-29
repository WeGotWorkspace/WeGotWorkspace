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
    public function __construct(
        private readonly IcsJmapTaskConverter $converter = new IcsJmapTaskConverter,
    ) {}

    /**
     * @return list<array<string, mixed>>
     */
    public function toTasks(CalendarObject $object, string $taskListUri): array
    {
        $raw = $object->calendardata;
        $tasks = $this->converter->tasksFromIcs($raw, (string) $object->uri, $taskListUri);
        $etag = OptimisticConcurrency::formatEtag($object->etag);
        $lastModified = (int) ($object->lastmodified ?? 0);
        if ($lastModified <= 0 && $etag === null) {
            return $tasks;
        }

        $timestamp = $lastModified > 0 ? gmdate('Y-m-d\TH:i:s\Z', $lastModified) : null;

        return array_map(function (array $task) use ($timestamp, $etag): array {
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

            return $task;
        }, $tasks);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function toTask(CalendarObject $object, string $taskListUri, ?string $vtodoUid = null): ?array
    {
        $raw = $object->calendardata;
        $task = $this->converter->taskFromIcsComponent($raw, (string) $object->uri, $taskListUri, $vtodoUid);
        if ($task === null) {
            return null;
        }

        $etag = OptimisticConcurrency::formatEtag($object->etag);
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

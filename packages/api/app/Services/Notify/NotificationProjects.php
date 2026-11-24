<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\JmapFileNode;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Projects\ProjectKind;
use App\Services\Projects\ProjectRegistry;

/**
 * The Project a notification's subject belongs to (#810), stored as `notifications.project_id`
 * so the inbox can follow the suite's Project filter. Null for a subject in no Project: a
 * direct message, an item of a personal calendar, a file outside any Team Drive.
 *
 * Collections go through {@see ProjectRegistry}. A file under a Project's Drive folder belongs
 * to that Project; any other file in a Team Drive (`groups/{team}/…`) belongs to the Team's
 * default Project, whose Drive view is the whole Team Drive.
 */
final class NotificationProjects
{
    /** @var array<string, string>|null storage key of a Project's Drive folder => project id */
    private ?array $folders = null;

    public function __construct(private readonly ProjectRegistry $registry) {}

    /** A calendar, task list, notebook or chat channel, by `calendars.id`. */
    public function forCollection(int $calendarId): ?string
    {
        return $this->registry->projectIdFor($calendarId);
    }

    /** A chat channel by its collection uri (a DM is in no Project). */
    public function forChannelUri(?string $channelUri): ?string
    {
        if ($channelUri === null || trim($channelUri) === '') {
            return null;
        }
        foreach (CalendarInstance::query()->where('uri', $channelUri)->pluck('calendarid') as $calendarId) {
            $projectId = $this->registry->projectIdFor((int) $calendarId);
            if ($projectId !== null) {
                return $projectId;
            }
        }

        return null;
    }

    /** An event or task by iCalendar UID: the Project of the collection that holds it. */
    public function forObjectUid(string $uid): ?string
    {
        $uid = trim($uid);
        if ($uid === '') {
            return null;
        }
        $calendarIds = CalendarObject::query()->where('uid', $uid)->pluck('calendarid');
        foreach ($calendarIds as $calendarId) {
            $projectId = $this->registry->projectIdFor((int) $calendarId);
            if ($projectId !== null) {
                return $projectId;
            }
        }

        return null;
    }

    /** A Drive or Docs item by its storage path (`groups/{team}/…`). */
    public function forPath(string $path): ?string
    {
        $path = trim($path, '/');
        if (preg_match('#^groups/([^/]+)(?:/|$)#', $path, $match) !== 1) {
            return null;
        }
        foreach ($this->folders() as $key => $projectId) {
            if ($path === $key || str_starts_with($path, $key.'/')) {
                return $projectId;
            }
        }
        $default = Project::query()->where('default_for_group', $match[1])->value('id');

        return is_string($default) ? $default : null;
    }

    /** @return array<string, string> */
    private function folders(): array
    {
        if ($this->folders !== null) {
            return $this->folders;
        }
        $byNode = ProjectResource::query()
            ->where('kind', ProjectKind::DriveFolder->value)
            ->pluck('project_id', 'locator')
            ->all();
        $this->folders = [];
        foreach (array_chunk(array_keys($byNode), 500) as $chunk) {
            foreach (JmapFileNode::query()->whereIn('node_id', $chunk)->whereNull('deleted_at')->get(['node_id', 'storage_key']) as $node) {
                $this->folders[trim((string) $node->storage_key, '/')] = (string) $byNode[(string) $node->node_id];
            }
        }

        return $this->folders;
    }
}

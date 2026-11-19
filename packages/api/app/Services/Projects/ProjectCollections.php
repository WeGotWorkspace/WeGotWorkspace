<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Models\Calendar;
use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Services\Calendars\CalDavCollections;
use App\Services\Calendars\CalendarColorPalette;
use App\Services\Chat\ChatChannelIdAllocator;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\PropPatch;

/**
 * Creates and renames the four CalDAV collections of a Project (#817), under the
 * Team principal and through the Sabre backend, so sync tokens and change feeds
 * move as for any other collection.
 *
 * Only the Projects services call this. It bypasses the client-facing guards of
 * the collection repositories: those refuse a Team collection to anyone but a
 * team admin, and (later) any rename of a Project collection.
 *
 * Not final: ProjectCreateRollbackTest replaces one step to prove the create
 * transaction leaves nothing behind.
 */
class ProjectCollections
{
    public function __construct(
        private readonly CalDavCollections $collections,
        private readonly WgwCalendarBackendFactory $backends,
        private readonly ChatChannelIdAllocator $channelIds,
    ) {}

    /** Create one collection of the Project and return its `calendars.id`. */
    public function create(ProjectKind $kind, string $groupPrincipalUri, string $projectSlug, string $name, ?string $color): int
    {
        $uri = $this->allocateUri($kind, $groupPrincipalUri, $projectSlug, $name);
        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet($kind->components()),
        ];
        if ($kind->hasColor()) {
            $properties[CalendarColorPalette::PROPERTY] = $color ?? CalendarColorPalette::forUri($uri);
        }

        $this->backends->make()->createCollection($kind->collectionKind(), $groupPrincipalUri, $uri, $properties);

        $calendarId = (int) CalendarInstance::query()
            ->where('principaluri', $groupPrincipalUri)
            ->where('uri', $uri)
            ->value('calendarid');
        if ($calendarId === 0) {
            throw new \RuntimeException('Project collection '.$uri.' was not created.');
        }
        if ($kind === ProjectKind::Channel) {
            ChatChannelMeta::query()->create([
                'calendarid' => $calendarId,
                'kind' => ChatChannelMeta::KIND_CHANNEL,
            ]);
        }

        return $calendarId;
    }

    /** Whether the collection with this `calendars.id` still exists. */
    public function exists(int $calendarId): bool
    {
        return Calendar::query()->whereKey($calendarId)->exists();
    }

    /**
     * The Team-owned instances of these collections, keyed by `calendars.id`.
     *
     * @param  list<int>  $calendarIds
     * @return array<int, CalendarInstance>
     */
    public function ownerInstances(string $groupPrincipalUri, array $calendarIds): array
    {
        if ($calendarIds === []) {
            return [];
        }
        $byId = [];
        foreach (CalendarInstance::query()
            ->where('principaluri', $groupPrincipalUri)
            ->whereIn('calendarid', $calendarIds)
            ->get() as $instance) {
            $byId[(int) $instance->calendarid] = $instance;
        }

        return $byId;
    }

    /** Write the Project's name, and its color where the kind has one, onto the Team-owned instance. */
    public function writeAppearance(ProjectKind $kind, CalendarInstance $instance, string $name, ?string $color): void
    {
        $mutations = [];
        if (trim((string) ($instance->displayname ?? '')) !== $name) {
            $mutations['{DAV:}displayname'] = $name;
        }
        if ($kind->hasColor() && $color !== null && CalendarColorPalette::normalize($instance->calendarcolor) !== $color) {
            $mutations[CalendarColorPalette::PROPERTY] = $color;
        }
        if ($mutations === []) {
            return;
        }

        $propPatch = new PropPatch($mutations);
        $this->backends->make()->updateCalendar($this->collections->backendId($instance), $propPatch);
        $propPatch->commit();
    }

    /**
     * Uris carry the `prj-` prefix so they never collide with a Team's provisioned
     * uris (`{slug}`, `tasks-{slug}`, `notes-{slug}`) or the `group-` API ids.
     * A channel id is unique across the instance and comes from the channel allocator.
     */
    /**
     * Hard-delete a collection with its items and sharee copies (purge, #819). Nothing to do
     * when it is already gone, so a purge that stopped half-way completes on retry.
     */
    public function delete(string $groupPrincipalUri, int $calendarId): void
    {
        $instance = $this->ownerInstances($groupPrincipalUri, [$calendarId])[$calendarId] ?? null;
        if ($instance !== null) {
            $this->backends->calBackend()->deleteCalendar($this->collections->backendId($instance));
        }
    }

    private function allocateUri(ProjectKind $kind, string $groupPrincipalUri, string $projectSlug, string $name): string
    {
        return match ($kind) {
            ProjectKind::Calendar => $this->collections->freeUri($groupPrincipalUri, 'prj-'.$projectSlug),
            ProjectKind::TaskList => $this->collections->freeUri($groupPrincipalUri, 'prj-'.$projectSlug.'-tasks'),
            ProjectKind::Notebook => $this->collections->freeUri($groupPrincipalUri, 'prj-'.$projectSlug.'-notes'),
            ProjectKind::Channel => $this->channelIds->allocate(null, $name, static fn (): bool => false),
            ProjectKind::DriveFolder => throw new \LogicException('A Drive folder is not a CalDAV collection.'),
        };
    }
}

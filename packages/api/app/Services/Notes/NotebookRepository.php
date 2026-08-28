<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Plugin as CalDAVPlugin;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

final class NotebookRepository
{
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    public function __construct(
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
        private readonly DriveGroupResolver $groups,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CalendarShareInvites $shareInvites,
    ) {}

    public function list(string $username): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->principalUri($username));

        $lists = $this->collectionAccess
            ->accessibleInstances($username, fn ($query) => $query->vjournalOnly())
            ->map(function (CalendarInstance $instance): array {
                $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

                return $this->mapNotebook($instance, $groupSlug);
            })
            ->values()
            ->all();

        return ['list' => $lists];
    }

    public function show(string $username, string $notebookId): array
    {
        $instance = $this->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }

        $groupSlug = CalendarCollectionUris::parseGroupNotebookApiId($notebookId)
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapNotebook($instance, $groupSlug);
    }

    public function create(string $username, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'bad_request');
        }

        $groupSlug = isset($payload['groupSlug']) && is_string($payload['groupSlug'])
            ? trim($payload['groupSlug'])
            : null;
        if ($groupSlug === '') {
            $groupSlug = null;
        }

        if ($groupSlug !== null) {
            if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                throw new ApiHttpException(403, 'Not a member of this group.', 'forbidden');
            }
            $principalUri = AdminConstants::GROUP_PREFIX.$groupSlug;
            $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
            if ($group === null) {
                throw new ApiHttpException(404, 'Group not found.', 'not_found');
            }
            $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
                (string) $group->uri,
                (string) ($group->displayname ?? $groupSlug),
            );
        } else {
            $principalUri = $this->principalUri($username);
        }

        $uri = $this->allocateNotebookUri(
            $principalUri,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
            $name,
        );
        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
        ];
        if (array_key_exists('description', $payload)) {
            $properties['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($payload['description']) ? $payload['description'] : null;
        }
        if (array_key_exists('color', $payload) && is_string($payload['color']) && trim($payload['color']) !== '') {
            $properties[self::CALENDAR_COLOR_PROPERTY] = trim($payload['color']);
        }

        try {
            $this->calBackend()->createCalendar($principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findNotebookInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created notebook.', 'server_error');
        }

        return $this->mapNotebook($instance, $groupSlug);
    }

    public function update(string $username, string $notebookId, array $payload): array
    {
        $resolved = $this->resolveWritableNotebook($username, $notebookId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;

        $this->collectionAccess->assertShareePatchAllowed(
            $instance,
            $payload,
            ['description', 'shareWith', 'groupSlug'],
            'Sharees can only change their own notebook name and color.',
        );

        $mutations = [];
        if (array_key_exists('name', $payload)) {
            $name = trim((string) $payload['name']);
            if ($name === '') {
                throw new ApiHttpException(400, 'name must not be empty.', 'invalidProperties');
            }
            $mutations['{DAV:}displayname'] = $name;
        }
        if (array_key_exists('description', $payload)) {
            $mutations['{'.CalDAVPlugin::NS_CALDAV.'}calendar-description'] = is_string($payload['description']) ? $payload['description'] : null;
        }
        if (array_key_exists('color', $payload)) {
            $color = $payload['color'];
            $mutations[self::CALENDAR_COLOR_PROPERTY] = is_string($color) && trim($color) !== '' ? trim($color) : null;
        }

        if ($mutations !== []) {
            $propPatch = new PropPatch($mutations);
            $this->calBackend()->updateCalendar($this->calBackendCalendarId($instance), $propPatch);
            $propPatch->commit();
        }

        if (array_key_exists('shareWith', $payload)) {
            $this->shareInvites->apply($instance, $groupSlug, $payload['shareWith']);
        }

        if (array_key_exists('groupSlug', $payload)) {
            $this->transferOwner($username, $instance, $groupSlug, $payload['groupSlug']);
        }

        $instance->refresh();
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapNotebook($instance, $groupSlug);
    }

    public function delete(string $username, string $notebookId, array $options = []): array
    {
        $resolved = $this->resolveWritableNotebook($username, $notebookId);
        if ($resolved === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }
        [$instance, $groupSlug] = $resolved;
        if ($this->collectionAccess->dismissIfSharee($username, $instance)) {
            return ['ok' => true];
        }
        if ((string) $instance->uri === CalendarCollectionUris::NOTE_GENERAL) {
            throw new ApiHttpException(403, 'The General notebook cannot be deleted.', 'forbidden');
        }
        if ($this->isProvisionedGroupNotebook($instance, $groupSlug)) {
            throw new ApiHttpException(403, 'The group notebook cannot be deleted.', 'forbidden');
        }
        if ($instance->objects()->where('componenttype', 'VJOURNAL')->exists() && ! ($options['onDestroyRemoveContents'] ?? false)) {
            throw new ApiHttpException(409, 'Notebook contains notes.', 'notebookHasContents');
        }

        $this->calBackend()->deleteCalendar($this->calBackendCalendarId($instance));

        return ['ok' => true];
    }

    public function changes(string $username, ?string $since): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->principalUri($username));
        $instances = $this->collectionAccess->accessibleInstances(
            $username,
            fn ($query) => $query->vjournalOnly(),
        );

        $currentState = $this->computeInstancesState($instances);
        $previous = $this->parseInstancesState($since);

        if ($since === null || $since === '' || $since === '0') {
            return ['oldState' => '0', 'newState' => $currentState, 'created' => $this->apiIdsForInstances($instances), 'updated' => [], 'destroyed' => []];
        }
        if ($since === $currentState) {
            return ['oldState' => $since, 'newState' => $currentState, 'created' => [], 'updated' => [], 'destroyed' => []];
        }
        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($instances as $instance) {
            $currentMap[$this->apiIdForInstance($instance)] = (int) ($instance->calendar?->synctoken ?? 1);
        }
        $created = [];
        $updated = [];
        foreach ($currentMap as $uri => $token) {
            if (! array_key_exists($uri, $previous)) {
                $created[] = $uri;
            } elseif ($previous[$uri] !== $token) {
                $updated[] = $uri;
            }
        }
        $destroyed = [];
        foreach (array_keys($previous) as $uri) {
            if (! array_key_exists($uri, $currentMap)) {
                $destroyed[] = $uri;
            }
        }

        return ['oldState' => $since, 'newState' => $currentState, 'created' => $created, 'updated' => $updated, 'destroyed' => $destroyed];
    }

    public function findOwnedNotebook(string $username, string $notebookId): ?CalendarInstance
    {
        if (CalendarCollectionUris::parseGroupNotebookApiId($notebookId) !== null) {
            return null;
        }

        return $this->findNotebookInstance($this->principalUri($username), $notebookId);
    }

    /**
     * @return array<string, mixed>
     */
    public function findOrCreateNamed(string $username, string $name, ?string $groupSlug = null): array
    {
        foreach ($this->list($username)['list'] as $notebook) {
            $sameName = ($notebook['name'] ?? '') === $name;
            $sameScope = ($notebook['groupSlug'] ?? null) === $groupSlug;
            $owned = ($notebook['isSharee'] ?? false) !== true;
            if ($sameName && $sameScope && $owned) {
                return $notebook;
            }
        }

        return $this->create($username, [
            'name' => $name,
            ...(is_string($groupSlug) && $groupSlug !== '' ? ['groupSlug' => $groupSlug] : []),
        ]);
    }

    public function findAccessibleNotebook(string $username, string $notebookId): ?CalendarInstance
    {
        $groupSlug = CalendarCollectionUris::parseGroupNotebookApiId($notebookId);
        if ($groupSlug !== null) {
            if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                return null;
            }

            return $this->ensureGroupNotebookInstance($groupSlug);
        }

        $owned = $this->findOwnedNotebook($username, $notebookId);
        if ($owned !== null) {
            return $owned;
        }

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $instance = $this->findNotebookInstance(AdminConstants::GROUP_PREFIX.$slug, $notebookId);
            if ($instance !== null) {
                return $instance;
            }
        }

        return null;
    }

    public function findAccessibleInstanceForCalendar(string $username, int $calendarId): ?CalendarInstance
    {
        return $this->collectionAccess
            ->accessibleInstances($username, fn ($query) => $query->vjournalOnly())
            ->first(fn (CalendarInstance $instance): bool => (int) $instance->calendarid === $calendarId);
    }

    public function apiIdForInstance(CalendarInstance $instance): string
    {
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);
        if ($groupSlug !== null) {
            $uri = (string) $instance->uri;
            if ($uri === CalendarCollectionUris::groupNotebookCalDavUri($groupSlug)) {
                return CalendarCollectionUris::groupNotebookApiId($groupSlug);
            }
        }

        return (string) $instance->uri;
    }

    /**
     * @return array{0: CalendarInstance, 1: ?string}|null
     */
    private function resolveWritableNotebook(string $username, string $notebookId): ?array
    {
        $instance = $this->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            return null;
        }

        $groupSlug = CalendarCollectionUris::parseGroupNotebookApiId($notebookId)
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return [$instance, $groupSlug];
    }

    private function isProvisionedGroupNotebook(CalendarInstance $instance, ?string $groupSlug): bool
    {
        return $groupSlug !== null
            && (string) $instance->uri === CalendarCollectionUris::groupNotebookCalDavUri($groupSlug);
    }

    /**
     * Notes stay on calendarid; sharee rows and shareWith grants are untouched.
     */
    private function transferOwner(
        string $username,
        CalendarInstance $instance,
        ?string $currentGroupSlug,
        mixed $requested,
    ): void {
        $this->assertOwnerTransferAllowed($instance, $currentGroupSlug);
        $newGroupSlug = $this->normalizePatchGroupSlug($requested);
        if ($newGroupSlug === $currentGroupSlug) {
            return;
        }

        $principalUri = $this->principalUriForOwnerScope($username, $instance, $newGroupSlug);
        $existing = $this->findNotebookInstance($principalUri, (string) $instance->uri);
        if ($existing !== null && (int) $existing->id !== (int) $instance->id) {
            throw new ApiHttpException(409, 'Notebook id already exists.', 'alreadyExists');
        }

        $instance->principaluri = $principalUri;
        $instance->save();
    }

    private function assertOwnerTransferAllowed(CalendarInstance $instance, ?string $currentGroupSlug): void
    {
        if ($this->shareInvites->isSharee($instance)) {
            throw new ApiHttpException(403, 'Sharees cannot change notebook owner.', 'forbidden');
        }
        if (! $this->shareInvites->canShare($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'Only notebook administrators can change owner.', 'forbidden');
        }
        $uri = (string) $instance->uri;
        if ($uri === CalendarCollectionUris::NOTE_GENERAL || $uri === CalendarCollectionUris::NOTE_GENERAL) {
            throw new ApiHttpException(403, 'The General notebook cannot change owner.', 'forbidden');
        }
        if ($this->isProvisionedGroupNotebook($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'The group notebook cannot change owner.', 'forbidden');
        }
    }

    private function normalizePatchGroupSlug(mixed $requested): ?string
    {
        if ($requested !== null && ! is_string($requested)) {
            throw new ApiHttpException(400, 'groupSlug must be a string or null.', 'invalidProperties');
        }

        $groupSlug = is_string($requested) ? trim($requested) : null;

        return $groupSlug === '' ? null : $groupSlug;
    }

    private function principalUriForOwnerScope(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
    ): string {
        if ($groupSlug === null) {
            return $this->principalUri($username);
        }
        if (! in_array($groupSlug, $this->groups->allowedGroupSlugs($username), true)) {
            throw new ApiHttpException(403, 'Not a member of this group.', 'forbidden');
        }
        $principalUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
        if ($group === null) {
            throw new ApiHttpException(404, 'Group not found.', 'not_found');
        }
        $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
            (string) $group->uri,
            (string) ($group->displayname ?? $groupSlug),
        );
        if ((string) $instance->uri === CalendarCollectionUris::groupNotebookCalDavUri($groupSlug)) {
            throw new ApiHttpException(409, 'Notebook id already exists.', 'alreadyExists');
        }

        return $principalUri;
    }

    private function allocateNotebookUri(string $principalUri, ?string $requestedId, string $name): string
    {
        if ($requestedId !== null && $requestedId !== '') {
            if (
                in_array($requestedId, CalendarCollectionUris::reservedNoteUriSlugs(), true)
                || $this->findNotebookInstance($principalUri, $requestedId) !== null
            ) {
                throw new ApiHttpException(409, 'Notebook id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }
        $base = Str::slug($name, '-') ?: 'notes';
        if (str_starts_with($base, 'group-')) {
            $base = 'notebook-'.substr($base, strlen('group-'));
        }
        if ($base === '' || in_array($base, CalendarCollectionUris::reservedNoteUriSlugs(), true)) {
            $base = 'notebook';
        }
        $candidate = $base;
        $suffix = 2;
        while ($this->findNotebookInstance($principalUri, $candidate) !== null) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    private function computeInstancesState($instances): string
    {
        $parts = [];
        foreach ($instances as $instance) {
            $parts[] = $this->apiIdForInstance($instance).':'.(int) ($instance->calendar?->synctoken ?? 1);
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    private function parseInstancesState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }
        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }
        $entries = $matches[2] === '' ? [] : explode(',', $matches[2]);
        if (count($entries) !== (int) $matches[1]) {
            return null;
        }
        $map = [];
        foreach ($entries as $entry) {
            $parts = explode(':', $entry, 2);
            if (count($parts) !== 2 || $parts[0] === '' || ! ctype_digit($parts[1])) {
                return null;
            }
            $map[$parts[0]] = (int) $parts[1];
        }

        return $map;
    }

    private function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function mapNotebook(CalendarInstance $instance, ?string $groupSlug = null): array
    {
        $uri = (string) $instance->uri;
        $name = trim((string) ($instance->displayname ?? '')) ?: $uri;
        $isGroup = $groupSlug !== null;
        $isSharedGroupList = $this->isProvisionedGroupNotebook($instance, $groupSlug);
        $isSharee = $this->shareInvites->isSharee($instance);
        $isOwnedGeneral = ! $isSharee && ! $isGroup && $uri === CalendarCollectionUris::NOTE_GENERAL;
        $mayShare = $this->shareInvites->canShare($instance, $groupSlug);
        $mayWrite = ! $this->shareInvites->isReadOnly($instance);

        $rights = match ((int) ($instance->access ?? SharingPlugin::ACCESS_SHAREDOWNER)) {
            SharingPlugin::ACCESS_READ => [
                'mayReadItems' => true,
                'mayWriteAll' => false,
                'mayWriteOwn' => false,
                'mayUpdatePrivate' => false,
                'mayRSVP' => false,
                'mayAdmin' => false,
                'mayDelete' => true,
                'mayShare' => false,
            ],
            SharingPlugin::ACCESS_READWRITE => [
                'mayReadItems' => true,
                'mayWriteAll' => true,
                'mayWriteOwn' => true,
                'mayUpdatePrivate' => true,
                'mayRSVP' => true,
                'mayAdmin' => false,
                'mayDelete' => true,
                'mayShare' => false,
            ],
            default => [
                'mayReadItems' => true,
                'mayWriteAll' => $mayWrite,
                'mayWriteOwn' => $mayWrite,
                'mayUpdatePrivate' => $mayWrite,
                'mayRSVP' => $mayWrite,
                'mayAdmin' => false,
                'mayDelete' => ! $isSharedGroupList && $uri !== CalendarCollectionUris::NOTE_GENERAL,
                'mayShare' => $mayShare,
            ],
        };

        return [
            'id' => $isSharedGroupList ? CalendarCollectionUris::groupNotebookApiId($groupSlug) : $uri,
            'role' => match (true) {
                $isOwnedGeneral => 'general',
                $isSharedGroupList => 'group',
                $isSharee => null,
                default => null,
            },
            'name' => $name,
            'description' => is_string($instance->description) && trim($instance->description) !== '' ? trim($instance->description) : null,
            'color' => is_string($instance->calendarcolor) && trim($instance->calendarcolor) !== '' ? trim($instance->calendarcolor) : null,
            'sortOrder' => (int) ($instance->calendarorder ?? $instance->id ?? 0),
            'isDefault' => $isOwnedGeneral,
            'isSubscribed' => true,
            'scope' => $isGroup ? 'group' : 'personal',
            'groupSlug' => $isGroup ? $groupSlug : null,
            'shareWith' => $this->shareInvites->shareWithForOwner($instance, $groupSlug),
            'isSharee' => $isSharee,
            'myRights' => $rights,
        ];
    }

    /**
     * @return list<CalendarInstance>
     */
    private function groupNotebookInstances(string $groupSlug): array
    {
        $groupUri = AdminConstants::GROUP_PREFIX.$groupSlug;
        $group = Principal::query()->where('uri', $groupUri)->first(['uri', 'displayname']);
        if ($group === null) {
            return [];
        }

        $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
            (string) $group->uri,
            (string) ($group->displayname ?? $groupSlug),
        );

        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $groupUri)
            ->whereHas('calendar', fn ($query) => $query->vjournalOnly())
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all();
    }

    private function findNotebookInstance(string $principalUri, string $notebookUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', $notebookUri)
            ->whereHas('calendar', fn ($query) => $query->vjournalOnly())
            ->first();
    }

    private function ensureGroupNotebookInstance(string $groupSlug): ?CalendarInstance
    {
        foreach ($this->groupNotebookInstances($groupSlug) as $instance) {
            if ((string) $instance->uri === CalendarCollectionUris::groupNotebookCalDavUri($groupSlug)) {
                return $instance;
            }
        }

        return null;
    }

    private function groupSlugFromPrincipalUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }

        $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));

        return $slug !== '' ? $slug : null;
    }

    /**
     * @param  iterable<CalendarInstance>  $instances
     * @return list<string>
     */
    private function apiIdsForInstances(iterable $instances): array
    {
        $ids = [];
        foreach ($instances as $instance) {
            $ids[] = $this->apiIdForInstance($instance);
        }

        return $ids;
    }

    private function principalUri(string $username): string
    {
        return 'principals/'.$username;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}

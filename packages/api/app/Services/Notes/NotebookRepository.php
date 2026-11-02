<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Dav\Server\WgwCalendarBackendFactory;
use App\Events\EventDispatch;
use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Calendars\CollectionKind;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Chat\ChatCollectionUris;
use App\Services\Docs\DocsThreadCollectionUris;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Notify\CollectionSharedNotify;
use Illuminate\Support\Collection;
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
        private readonly WgwCalendarBackendFactory $backends,
        private readonly NotebookNotesRelocation $notesRelocation,
        private readonly EventDispatch $eventDispatch = new EventDispatch([]),
    ) {}

    /** @return array<mixed> */
    public function list(string $username): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->principalUri($username));

        $lists = $this->accessibleNotebookInstances($username)
            ->map(function (CalendarInstance $instance) use ($username): array {
                $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

                return $this->mapNotebook($username, $instance, $groupSlug);
            })
            ->values()
            ->all();

        return ['list' => $lists];
    }

    /** @return array<mixed> */
    public function show(string $username, string $notebookId): array
    {
        $instance = $this->findAccessibleNotebook($username, $notebookId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Notebook not found.', 'not_found');
        }

        $groupSlug = CalendarCollectionUris::parseGroupNotebookApiId($notebookId)
            ?? $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        return $this->mapNotebook($username, $instance, $groupSlug);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<mixed>
     */
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
            $this->backends->make()->createCollection(CollectionKind::Notebook, $principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findNotebookInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created notebook.', 'server_error');
        }

        return $this->mapNotebook($username, $instance, $groupSlug);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<mixed>
     */
    public function update(string $username, string $notebookId, array $payload): array
    {
        return DB::connection('wgw')->transaction(function () use ($username, $notebookId, $payload): array {
            $this->collectionAccess->restoreWhenSubscribing($username, CollectionKind::Notebook, $notebookId, $payload);
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

            $mutations = $this->collectionAccess->propertyMutations($payload);

            if ($mutations !== []) {
                $propPatch = new PropPatch($mutations);
                $this->calBackend()->updateCalendar($this->calBackendCalendarId($instance), $propPatch);
                $propPatch->commit();
            }

            if (array_key_exists('shareWith', $payload)) {
                $this->notifyCollectionShare($username, $instance, $groupSlug, $payload['shareWith']);
            }

            if (array_key_exists('groupSlug', $payload)) {
                $this->transferOwner($username, $instance, $groupSlug, $payload['groupSlug']);
            }
            $this->collectionAccess->dismissWhenUnsubscribing($username, $instance, $payload);

            $instance->refresh();
            $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

            return $this->mapNotebook($username, $instance, $groupSlug);
        });
    }

    /**
     * @param  array<string, mixed>  $options
     * @return array<mixed>
     */
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
        $this->collectionAccess->assertGroupOwnedDeleteAllowed($username, $instance);
        $this->notesRelocation->commit(
            $instance,
            $options,
            fn (string $id): ?CalendarInstance => $this->findAccessibleNotebook($username, $id),
            fn () => $this->calBackend()->deleteCalendar($this->calBackendCalendarId($instance)),
        );

        return ['ok' => true];
    }

    /**
     * Current per-notebook sync tokens for every accessible VJOURNAL collection.
     *
     * @return array<string, string> notebook api id => synctoken
     */
    public function notebookSyncTokens(string $username): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->principalUri($username));
        $tokens = [];
        $instances = $this->accessibleNotebookInstances($username);
        foreach ($instances as $instance) {
            $tokens[$this->apiIdForInstance($instance)] = (string) (int) ($instance->calendar->synctoken ?? 1);
        }

        return $tokens;
    }

    /** @return array<mixed> */
    public function changes(string $username, ?string $since): array
    {
        $this->calendarCollectionsProvisioner->ensureForPrincipal($this->principalUri($username));
        $instances = $this->accessibleNotebookInstances($username);

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
            $currentMap[$this->apiIdForInstance($instance)] = (int) ($instance->calendar->synctoken ?? 1);
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

        return $this->collectionAccess->findReachable(
            $username,
            fn (string $principalUri): ?CalendarInstance => $this->findNotebookInstance($principalUri, $notebookId),
        );
    }

    public function findAccessibleInstanceForCalendar(string $username, int $calendarId): ?CalendarInstance
    {
        return $this->accessibleNotebookInstances($username)
            ->first(fn (CalendarInstance $instance): bool => (int) $instance->calendarid === $calendarId);
    }

    /**
     * Accessible notebooks. Chat channels and docs thread pools are VJOURNAL-only
     * too, so the stored CollectionKind is the discriminator — never the uri
     * prefix, which sharee instances do not carry (regression:
     * ChatNotebookIsolationTest, DocsThreadNotebookIsolationTest).
     *
     * @return Collection<int, CalendarInstance>
     */
    private function accessibleNotebookInstances(string $username)
    {
        return $this->collectionAccess
            ->accessibleInstances($username, CollectionKind::Notebook)
            ->values();
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
        $this->collectionAccess->assertGroupOwnedTransferAllowed($username, $instance);
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
            if (in_array($requestedId, CalendarCollectionUris::reservedNoteViewSlugs(), true)) {
                throw new ApiHttpException(
                    409,
                    'This notebook id is reserved for a Notes view.',
                    'alreadyExists',
                );
            }
            $reserved = $this->reservedPrefixOwner($requestedId);
            if ($reserved === CollectionKind::ChatChannel) {
                throw new ApiHttpException(
                    409,
                    'This notebook id is reserved for chat channels.',
                    'alreadyExists',
                );
            }
            if ($reserved === CollectionKind::DocsThreadPool) {
                throw new ApiHttpException(
                    409,
                    'This notebook id is reserved for docs threads.',
                    'alreadyExists',
                );
            }
            if (
                in_array($requestedId, CalendarCollectionUris::reservedNoteUriSlugs(), true)
                || $this->collectionUriTaken($principalUri, $requestedId)
            ) {
                throw new ApiHttpException(409, 'Notebook id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }
        $base = Str::slug($name, '-') ?: 'notes';
        if (str_starts_with($base, 'group-')) {
            $base = 'notebook-'.substr($base, strlen('group-'));
        }
        if ($this->reservedPrefixOwner($base) !== null) {
            $base = 'notebook-'.$base;
        }
        if (in_array($base, CalendarCollectionUris::reservedNoteUriSlugs(), true)) {
            $base = 'notebook';
        }
        $candidate = $base;
        $suffix = 2;
        while ($this->collectionUriTaken($principalUri, $candidate)) {
            $candidate = $base.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    /** @param iterable<CalendarInstance> $instances */
    private function computeInstancesState(iterable $instances): string
    {
        $parts = [];
        foreach ($instances as $instance) {
            $parts[] = $this->apiIdForInstance($instance).':'.(int) ($instance->calendar->synctoken ?? 1);
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    /** @return array<mixed> */
    private function parseInstancesState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }
        if (! preg_match('/^(\d+):(.+)$/', $state, $matches)) {
            return null;
        }
        $entries = explode(',', $matches[2]);
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

    /** @return array<mixed> */
    private function calBackendCalendarId(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function notifyCollectionShare(
        string $username,
        CalendarInstance $instance,
        ?string $groupSlug,
        mixed $shareWith,
    ): void {
        $added = CollectionSharedNotify::applyAndAddedUsernames(
            $this->shareInvites,
            $instance,
            $groupSlug,
            $shareWith,
        );
        if ($added === []) {
            return;
        }
        $grants = $this->shareInvites->shareWithForOwner($instance, $groupSlug) ?? [];
        $mapped = $this->mapNotebook($username, $instance, $groupSlug);
        $name = (string) ($mapped['name'] ?? $mapped['id'] ?? 'notebook');
        $id = (string) ($mapped['id'] ?? $instance->uri);
        foreach ($added as $sharee) {
            $grant = $grants[$sharee] ?? null;
            $access = is_array($grant) && $grant['mayWrite'] === true ? 'write' : 'read';
            $this->eventDispatch->fireMutation(
                $username,
                'notes',
                CollectionSharedNotify::NOTES_ACTION,
                'notes/'.$id,
                CollectionSharedNotify::eventData(
                    'notes',
                    CollectionSharedNotify::actorLabel($username),
                    $name,
                    $id,
                    $access,
                    [$sharee],
                ),
            );
        }
    }

    /** @return array<mixed> */
    private function mapNotebook(string $username, CalendarInstance $instance, ?string $groupSlug = null): array
    {
        $uri = (string) $instance->uri;
        $name = trim((string) ($instance->displayname ?? '')) ?: $uri;
        $isGroup = $groupSlug !== null;
        $isSharedGroupList = $this->isProvisionedGroupNotebook($instance, $groupSlug);
        $isSharee = $this->shareInvites->isSharee($instance);
        $isOwnedGeneral = ! $isSharee && ! $isGroup && $uri === CalendarCollectionUris::NOTE_GENERAL;
        $mayShare = $this->shareInvites->canShare($instance, $groupSlug);
        $mayWrite = ! $this->shareInvites->isReadOnly($instance);
        $groupMayDelete = $this->collectionAccess->mayDeleteGroupOwned($username, $instance);
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
                'mayDelete' => $groupMayDelete && ! $isSharedGroupList && $uri !== CalendarCollectionUris::NOTE_GENERAL,
                'mayShare' => $mayShare,
            ],
        };

        return [
            'id' => $isSharedGroupList && is_string($groupSlug) ? CalendarCollectionUris::groupNotebookApiId($groupSlug) : $uri,
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

        return array_values(CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $groupUri)
            ->whereHas('calendar', fn ($query) => $query->ofKind(CollectionKind::Notebook))
            ->orderBy('calendarorder')
            ->orderBy('id')
            ->get()
            ->all());
    }

    private function findNotebookInstance(string $principalUri, string $notebookUri): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', $notebookUri)
            ->whereHas('calendar', fn ($query) => $query->ofKind(CollectionKind::Notebook))
            ->first();
    }

    /**
     * Prefixes that belong to another app. A notebook must not be created on
     * them: chat-/dm- would shadow Meet rooms, and docs-threads would block
     * the thread pool for that principal.
     */
    private function reservedPrefixOwner(string $uri): ?CollectionKind
    {
        if (ChatCollectionUris::isChatUri($uri)) {
            return CollectionKind::ChatChannel;
        }
        if (str_starts_with($uri, DocsThreadCollectionUris::POOL_URI)) {
            return CollectionKind::DocsThreadPool;
        }

        return null;
    }

    /**
     * Any collection on this principal under this uri, whatever app owns it.
     * A notebook may not be minted on top of a chat channel or a docs thread
     * pool, and the kind-scoped finders deliberately cannot see those.
     */
    private function collectionUriTaken(string $principalUri, string $uri): bool
    {
        return CalendarInstance::query()
            ->where('principaluri', $principalUri)
            ->where('uri', $uri)
            ->exists();
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

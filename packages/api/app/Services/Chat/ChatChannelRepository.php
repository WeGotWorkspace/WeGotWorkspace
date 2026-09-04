<?php

declare(strict_types=1);

namespace App\Services\Chat;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarShareInvites;
use App\Services\Calendars\CalendarShareVisibility;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Drive\DriveGroupResolver;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Sabre\DAV\Exception\BadRequest;
use Sabre\DAV\PropPatch;
use Sabre\DAV\Sharing\Plugin as SharingPlugin;

/**
 * Chat channels are CalDAV VJOURNAL-only collections with `chat-`/`dm-` URI
 * prefixes — the same collection model, sharing matrix, and changes feed that
 * NotebookRepository runs in production for Notes (known pattern, new payload).
 *
 * Differences from notebooks, by design:
 * - URI prefix is the notebook/chat discriminator; both repositories filter on
 *   it (regression tests: ChatNotebookIsolationTest).
 * - Sharee instances are re-pointed at the owner's `chat-`/`dm-` uri right
 *   after invite writes (Sabre mints a random UUID) so channel ids are stable
 *   across members and prefix discrimination holds for sharees too.
 * - kind/topic/room_code live in the chat_channel_meta side table.
 * - Channels are never DAV-visible (ChatHiddenCalendarBackend).
 */
final class ChatChannelRepository
{
    private const CALENDAR_COLOR_PROPERTY = '{http://apple.com/ns/ical/}calendar-color';

    public function __construct(
        private readonly DriveGroupResolver $groups,
        private readonly CalendarCollectionAccess $collectionAccess,
        private readonly CalendarShareInvites $shareInvites,
        private readonly CalendarShareVisibility $shareVisibility,
        private readonly UserCalendarCollectionsProvisioner $calendarCollectionsProvisioner,
    ) {}

    /**
     * @return array{list: list<array<string, mixed>>}
     */
    public function list(string $username): array
    {
        $instances = $this->accessibleChatInstances($username);
        $metaByCalendar = $this->metaForInstances($instances);

        $list = [];
        foreach ($instances as $instance) {
            $list[] = $this->mapChannel(
                $username,
                $instance,
                $metaByCalendar[(int) $instance->calendarid] ?? null,
            );
        }

        return ['list' => $list];
    }

    /**
     * @return array<string, mixed>
     */
    public function show(string $username, string $channelId): array
    {
        $instance = $this->findAccessibleChannel($username, $channelId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Channel not found.', 'not_found');
        }

        return $this->mapChannel($username, $instance, $this->metaForCalendar((int) $instance->calendarid));
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function create(string $username, array $payload): array
    {
        $name = trim((string) ($payload['name'] ?? ''));
        if ($name === '') {
            throw new ApiHttpException(400, 'name is required.', 'bad_request');
        }
        $kind = (string) ($payload['kind'] ?? '');
        if (! in_array($kind, ChatChannelMeta::kinds(), true)) {
            throw new ApiHttpException(400, 'kind must be channel, meeting, or dm.', 'invalidProperties', ['kind']);
        }

        $groupSlug = isset($payload['groupSlug']) && is_string($payload['groupSlug'])
            ? (trim($payload['groupSlug']) ?: null)
            : null;

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

        $uri = $this->allocateChannelUri(
            $kind,
            isset($payload['id']) && is_string($payload['id']) ? $payload['id'] : null,
        );

        $properties = [
            '{DAV:}displayname' => $name,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VJOURNAL']),
        ];
        if (isset($payload['color']) && is_string($payload['color']) && trim($payload['color']) !== '') {
            $properties[self::CALENDAR_COLOR_PROPERTY] = trim($payload['color']);
        }

        try {
            $this->calBackend()->createCalendar($principalUri, $uri, $properties);
        } catch (BadRequest $exception) {
            throw new ApiHttpException(400, $exception->getMessage(), 'invalidProperties');
        }

        $instance = $this->findChannelInstance($principalUri, $uri);
        if ($instance === null) {
            throw new ApiHttpException(500, 'Could not load created channel.', 'server_error');
        }

        $topic = isset($payload['topic']) && is_string($payload['topic']) && trim($payload['topic']) !== ''
            ? trim($payload['topic'])
            : null;
        $meta = ChatChannelMeta::query()->create([
            'calendarid' => (int) $instance->calendarid,
            'kind' => $kind,
            'topic' => $topic,
        ]);

        return $this->mapChannel($username, $instance, $meta);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function update(string $username, string $channelId, array $payload): array
    {
        $instance = $this->findAccessibleChannel($username, $channelId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Channel not found.', 'not_found');
        }
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);

        // Sharees may only rename/recolor their own instance; topic lives in the
        // shared meta row, so it stays owner-side like shareWith and groupSlug.
        $this->collectionAccess->assertShareePatchAllowed(
            $instance,
            $payload,
            ['topic', 'shareWith', 'groupSlug'],
            'Sharees can only change their own channel name and color.',
        );

        $mutations = [];
        if (array_key_exists('name', $payload)) {
            $name = trim((string) $payload['name']);
            if ($name === '') {
                throw new ApiHttpException(400, 'name must not be empty.', 'invalidProperties');
            }
            $mutations['{DAV:}displayname'] = $name;
        }
        if (array_key_exists('color', $payload)) {
            $color = $payload['color'];
            $mutations[self::CALENDAR_COLOR_PROPERTY] = is_string($color) && trim($color) !== '' ? trim($color) : null;
        }
        if ($mutations !== []) {
            $propPatch = new PropPatch($mutations);
            $this->calBackend()->updateCalendar([(int) $instance->calendarid, (int) $instance->id], $propPatch);
            $propPatch->commit();
        }

        if (array_key_exists('topic', $payload)) {
            $topic = $payload['topic'];
            ChatChannelMeta::query()->updateOrCreate(
                ['calendarid' => (int) $instance->calendarid],
                ['topic' => is_string($topic) && trim($topic) !== '' ? trim($topic) : null],
            );
        }

        if (array_key_exists('shareWith', $payload)) {
            $this->shareInvites->apply($instance, $groupSlug, $payload['shareWith']);
            $this->normalizeShareeInstanceUris($instance);
        }

        if (array_key_exists('groupSlug', $payload)) {
            $this->transferOwner($username, $instance, $groupSlug, $payload['groupSlug']);
        }

        $instance->refresh();

        return $this->mapChannel($username, $instance, $this->metaForCalendar((int) $instance->calendarid));
    }

    /**
     * @return array{ok: true}
     */
    public function delete(string $username, string $channelId): array
    {
        $instance = $this->findAccessibleChannel($username, $channelId);
        if ($instance === null) {
            throw new ApiHttpException(404, 'Channel not found.', 'not_found');
        }
        if ($this->collectionAccess->dismissIfSharee($username, $instance)) {
            return ['ok' => true];
        }

        // Deleting a channel deletes its messages — chat_channel_meta cascades
        // away with the calendars row.
        $this->calBackend()->deleteCalendar([(int) $instance->calendarid, (int) $instance->id]);

        return ['ok' => true];
    }

    /**
     * Collection-level changes across all accessible channels — same
     * instances-state algorithm as NotebookRepository::changes.
     *
     * @return array{oldState: string, newState: string, created: list<string>, updated: list<string>, destroyed: list<string>}
     */
    public function changes(string $username, ?string $since): array
    {
        $instances = $this->accessibleChatInstances($username);

        $currentState = $this->computeInstancesState($instances);
        $previous = $this->parseInstancesState($since);

        if ($since === null || $since === '' || $since === '0') {
            return ['oldState' => '0', 'newState' => $currentState, 'created' => $this->urisForInstances($instances), 'updated' => [], 'destroyed' => []];
        }
        if ($since === $currentState) {
            return ['oldState' => $since, 'newState' => $currentState, 'created' => [], 'updated' => [], 'destroyed' => []];
        }
        if ($previous === null) {
            throw new ApiHttpException(400, 'Sync state is invalid or expired.', 'cannotCalculateChanges');
        }

        $currentMap = [];
        foreach ($instances as $instance) {
            $currentMap[(string) $instance->uri] = (int) ($instance->calendar?->synctoken ?? 1);
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

    public function findAccessibleChannel(string $username, string $channelId): ?CalendarInstance
    {
        if (! ChatCollectionUris::isChatUri($channelId)) {
            return null;
        }

        // Personal instance: owner or (uri-normalized) sharee copy.
        $instance = $this->findChannelInstance($this->principalUri($username), $channelId);
        if ($instance !== null) {
            if ($this->shareInvites->isSharee($instance)
                && $this->shareVisibility->isDismissed($username, (int) $instance->calendarid)) {
                return null;
            }

            return $instance;
        }

        foreach ($this->groups->allowedGroupSlugs($username) as $slug) {
            $instance = $this->findChannelInstance(AdminConstants::GROUP_PREFIX.$slug, $channelId);
            if ($instance !== null) {
                if ($this->shareInvites->isSharee($instance)
                    && $this->shareVisibility->isDismissed($username, (int) $instance->calendarid)) {
                    continue;
                }

                return $instance;
            }
        }

        return null;
    }

    public function findAccessibleInstanceForCalendar(string $username, int $calendarId): ?CalendarInstance
    {
        return $this->accessibleChatInstances($username)
            ->first(fn (CalendarInstance $instance): bool => (int) $instance->calendarid === $calendarId);
    }

    /**
     * @return array<string, mixed>
     */
    public function mapChannel(string $username, CalendarInstance $instance, ?ChatChannelMeta $meta): array
    {
        $uri = (string) $instance->uri;
        $groupSlug = $this->groupSlugFromPrincipalUri((string) $instance->principaluri);
        $isSharee = $this->shareInvites->isSharee($instance);
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
                'mayDelete' => true,
                'mayShare' => $mayShare,
            ],
        };

        return [
            'id' => $uri,
            'name' => trim((string) ($instance->displayname ?? '')) ?: $uri,
            'color' => is_string($instance->calendarcolor) && trim($instance->calendarcolor) !== '' ? trim($instance->calendarcolor) : null,
            'kind' => $meta?->kind ?? ChatChannelMeta::KIND_CHANNEL,
            'scope' => $groupSlug !== null ? 'group' : 'personal',
            'groupSlug' => $groupSlug,
            'shareWith' => $this->shareInvites->shareWithForOwner($instance, $groupSlug),
            'isSharee' => $isSharee,
            'myRights' => $rights,
            'topic' => $meta?->topic,
            'guestRoomCode' => $meta?->room_code,
            'memberCount' => $this->memberCount($instance, $groupSlug),
        ];
    }

    /**
     * @return Collection<int, CalendarInstance>
     */
    public function accessibleChatInstances(string $username)
    {
        return $this->collectionAccess
            ->accessibleInstances($username, fn ($query) => $query->vjournalOnly())
            ->filter(fn (CalendarInstance $instance): bool => ChatCollectionUris::isChatUri((string) $instance->uri))
            ->values();
    }

    /**
     * Sabre's updateInvites mints a random UUID uri for new sharee instances.
     * Chat re-points them at the owner's `chat-`/`dm-` uri so the channel id is
     * identical for every member and URI-prefix discrimination (notebooks vs
     * chat, DAV hiding) holds on sharee copies too.
     */
    private function normalizeShareeInstanceUris(CalendarInstance $owner): void
    {
        CalendarInstance::query()
            ->where('calendarid', (int) $owner->calendarid)
            ->whereIn('access', [SharingPlugin::ACCESS_READ, SharingPlugin::ACCESS_READWRITE])
            ->where('uri', '!=', (string) $owner->uri)
            ->update(['uri' => (string) $owner->uri]);
    }

    private function transferOwner(
        string $username,
        CalendarInstance $instance,
        ?string $currentGroupSlug,
        mixed $requested,
    ): void {
        if ($this->shareInvites->isSharee($instance)) {
            throw new ApiHttpException(403, 'Sharees cannot change channel owner.', 'forbidden');
        }
        if (! $this->shareInvites->canShare($instance, $currentGroupSlug)) {
            throw new ApiHttpException(403, 'Only channel administrators can change owner.', 'forbidden');
        }
        if ($requested !== null && ! is_string($requested)) {
            throw new ApiHttpException(400, 'groupSlug must be a string or null.', 'invalidProperties');
        }
        $newGroupSlug = is_string($requested) ? (trim($requested) ?: null) : null;
        if ($newGroupSlug === $currentGroupSlug) {
            return;
        }

        if ($newGroupSlug === null) {
            $principalUri = $this->principalUri($username);
        } else {
            if (! in_array($newGroupSlug, $this->groups->allowedGroupSlugs($username), true)) {
                throw new ApiHttpException(403, 'Not a member of this group.', 'forbidden');
            }
            $principalUri = AdminConstants::GROUP_PREFIX.$newGroupSlug;
            $group = Principal::query()->where('uri', $principalUri)->first(['uri', 'displayname']);
            if ($group === null) {
                throw new ApiHttpException(404, 'Group not found.', 'not_found');
            }
            $this->calendarCollectionsProvisioner->ensureForGroupPrincipal(
                (string) $group->uri,
                (string) ($group->displayname ?? $newGroupSlug),
            );
        }

        $existing = $this->findChannelInstance($principalUri, (string) $instance->uri);
        if ($existing !== null && (int) $existing->id !== (int) $instance->id) {
            throw new ApiHttpException(409, 'Channel id already exists.', 'alreadyExists');
        }

        $instance->principaluri = $principalUri;
        $instance->save();
    }

    private function allocateChannelUri(string $kind, ?string $requestedId): string
    {
        $prefix = $kind === ChatChannelMeta::KIND_DM ? ChatCollectionUris::PREFIX_DM : ChatCollectionUris::PREFIX_CHANNEL;

        if ($requestedId !== null && $requestedId !== '') {
            if (! str_starts_with($requestedId, $prefix)) {
                throw new ApiHttpException(400, 'Channel id must start with "'.$prefix.'" for this kind.', 'invalidProperties', ['id']);
            }
            // Channel ids are globally unique so every member addresses the same
            // id (sharee instances are normalized onto it).
            if (CalendarInstance::query()->where('uri', $requestedId)->exists()) {
                throw new ApiHttpException(409, 'Channel id already exists.', 'alreadyExists');
            }

            return $requestedId;
        }

        return $prefix.strtolower((string) Str::ulid());
    }

    private function findChannelInstance(string $principalUri, string $channelUri): ?CalendarInstance
    {
        if (! ChatCollectionUris::isChatUri($channelUri)) {
            return null;
        }

        return CalendarInstance::query()
            ->with('calendar')
            ->where('principaluri', $principalUri)
            ->where('uri', $channelUri)
            ->whereHas('calendar', fn ($query) => $query->vjournalOnly())
            ->first();
    }

    /**
     * Roster size: owner side (group members or the personal owner) plus
     * sharees, group sharees expanded, distinct by username.
     */
    private function memberCount(CalendarInstance $instance, ?string $groupSlug): int
    {
        $usernames = [];

        $ownerPrincipal = $this->ownerPrincipalUri($instance);
        foreach ($this->usernamesForPrincipalUri($ownerPrincipal) as $username) {
            $usernames[$username] = true;
        }

        foreach ($this->calBackend()->getInvites([(int) $instance->calendarid, (int) $instance->id]) as $sharee) {
            if ((int) $sharee->access === SharingPlugin::ACCESS_SHAREDOWNER || ! is_string($sharee->principal)) {
                continue;
            }
            foreach ($this->usernamesForPrincipalUri($sharee->principal) as $username) {
                $usernames[$username] = true;
            }
        }

        return count($usernames);
    }

    private function ownerPrincipalUri(CalendarInstance $instance): string
    {
        if (! $this->shareInvites->isSharee($instance)) {
            return (string) $instance->principaluri;
        }

        $owner = CalendarInstance::query()
            ->where('calendarid', (int) $instance->calendarid)
            ->where('access', SharingPlugin::ACCESS_SHAREDOWNER)
            ->first(['principaluri']);

        return (string) ($owner?->principaluri ?? $instance->principaluri);
    }

    /**
     * @return list<string>
     */
    private function usernamesForPrincipalUri(string $principalUri): array
    {
        if (str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return GroupMember::query()
                ->join('principals as g', 'g.id', '=', 'groupmembers.principal_id')
                ->join('principals as m', 'm.id', '=', 'groupmembers.member_id')
                ->where('g.uri', $principalUri)
                ->pluck('m.uri')
                ->map(static fn (mixed $uri): string => str_replace('principals/', '', (string) $uri))
                ->all();
        }
        if (str_starts_with($principalUri, 'principals/')) {
            return [substr($principalUri, strlen('principals/'))];
        }

        return [];
    }

    /**
     * @param  iterable<CalendarInstance>  $instances
     * @return array<int, ChatChannelMeta>
     */
    private function metaForInstances(iterable $instances): array
    {
        $calendarIds = [];
        foreach ($instances as $instance) {
            $calendarIds[] = (int) $instance->calendarid;
        }
        if ($calendarIds === []) {
            return [];
        }

        $map = [];
        foreach (ChatChannelMeta::query()->whereIn('calendarid', $calendarIds)->get() as $meta) {
            $map[(int) $meta->calendarid] = $meta;
        }

        return $map;
    }

    private function metaForCalendar(int $calendarId): ?ChatChannelMeta
    {
        return ChatChannelMeta::query()->find($calendarId);
    }

    /**
     * @param  iterable<CalendarInstance>  $instances
     */
    private function computeInstancesState(iterable $instances): string
    {
        $parts = [];
        foreach ($instances as $instance) {
            $parts[] = (string) $instance->uri.':'.(int) ($instance->calendar?->synctoken ?? 1);
        }

        return (string) count($parts).':'.implode(',', $parts);
    }

    /**
     * @return array<string, int>|null
     */
    private function parseInstancesState(?string $state): ?array
    {
        if ($state === null || $state === '' || $state === '0') {
            return [];
        }
        // Unlike notebooks (notes-general is always provisioned) a user can have
        // zero channels, so the empty state "0:" must parse.
        if (! preg_match('/^(\d+):(.*)$/', $state, $matches)) {
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

    /**
     * @param  iterable<CalendarInstance>  $instances
     * @return list<string>
     */
    private function urisForInstances(iterable $instances): array
    {
        $uris = [];
        foreach ($instances as $instance) {
            $uris[] = (string) $instance->uri;
        }

        return $uris;
    }

    private function groupSlugFromPrincipalUri(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, AdminConstants::GROUP_PREFIX)) {
            return null;
        }

        $slug = substr($principalUri, strlen(AdminConstants::GROUP_PREFIX));

        return $slug !== '' ? $slug : null;
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

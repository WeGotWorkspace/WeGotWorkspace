<?php

declare(strict_types=1);

namespace App\Services\Jmap\Push;

use App\Models\CalendarInstance;
use App\Services\Calendars\CalendarCollectionAccess;
use App\Services\Calendars\CalendarRepository;
use App\Services\Calendars\CollectionKind;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Chat\ChatGroupDefaultChannelProvisioner;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Docs\DocThreadPushState;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeRootMarkers;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Notes\NotebookRepository;
use App\Services\Notify\NotificationInboxMarkers;
use App\Services\Tasks\TaskListRepository;
use App\Support\WgwSettings;
use Illuminate\Database\Eloquent\Collection;

/**
 * Per-user state of every push type (#1660, docs/architecture/jmap-push.md).
 *
 * Each state comes from the same code as that type's `Foo/get` (or, for
 * tasks, the REST task list state): a composite over the collections the user
 * can access, so a state never covers data the user cannot read. Every read is
 * O(collections or roots the user can see); none scans change rows.
 *
 * Notes, calendars, chat and tasks are all CalDAV collections, so their
 * instances come from one read ({@see CalendarCollectionAccess::accessibleInstancesByKind()})
 * instead of one per source: that read repeats nothing per Team or per kind (#2243).
 *
 * `DocThread` (#2286) composes the Docs thread pools behind the user's file roots
 * ({@see DocThreadPushState}): a share root covers only the threads under it.
 *
 * `FileNode` is the exception in what is hashed: the pushed value is the
 * global sequence `FileNode/changes` expects, but the hash covers the sorted
 * `root → marker` pairs of the user's roots, so another user's write elsewhere
 * on the server does not change it.
 */
final class JmapPushStateResolver
{
    /** Push types in id order. Task names follow the JMAP Tasks draft. */
    public const TYPES = [
        'Note',
        'Notebook',
        'CalendarEvent',
        'Calendar',
        'ContactCard',
        'AddressBook',
        'ChatMessage',
        'ChatChannel',
        'FileNode',
        'Task',
        'TaskList',
        'Notification',
        'DocThread',
    ];

    /** Types that share one state source are resolved once. */
    private const SOURCE_OF_TYPE = [
        'Note' => 'notes',
        'Notebook' => 'notes',
        'CalendarEvent' => 'calendars',
        'Calendar' => 'calendars',
        'ContactCard' => 'contacts',
        'AddressBook' => 'contacts',
        'ChatMessage' => 'chat',
        'ChatChannel' => 'chat',
        'FileNode' => 'files',
        'Task' => 'tasks',
        'TaskList' => 'tasks',
        'Notification' => 'inbox',
        'DocThread' => 'docthreads',
    ];

    /** Sources whose state is a composite over CalDAV collections of one kind. */
    private const CALDAV_KIND_OF_SOURCE = [
        'notes' => CollectionKind::Notebook,
        'calendars' => CollectionKind::EventCalendar,
        'chat' => CollectionKind::ChatChannel,
        'tasks' => CollectionKind::TaskList,
    ];

    /** A JMAP-backed source is served only while its capability is enabled. */
    private const SOURCE_URN = [
        'notes' => JmapCapabilities::NOTES,
        'calendars' => JmapCapabilities::CALENDARS,
        'contacts' => JmapCapabilities::CONTACTS,
        'chat' => JmapCapabilities::CHAT,
        'files' => JmapCapabilities::FILENODE,
        'docthreads' => JmapCapabilities::FILENODE,
    ];

    /** @var array{roots: list<string>, grantPairs: string}|null `FileNode` and `DocThread` share one read per request */
    private ?array $rootsOfRequest = null;

    public function __construct(
        private readonly CalendarCollectionAccess $calDavAccess,
        private readonly NotebookRepository $notebooks,
        private readonly CalendarRepository $calendars,
        private readonly AddressBookRepository $books,
        private readonly ChatGroupDefaultChannelProvisioner $teamChannels,
        private readonly DriveGroupResolver $groups,
        private readonly TaskListRepository $taskLists,
        private readonly FileNodeAccountSupport $fileAccounts,
        private readonly FileNodeRootMarkers $fileMarkers,
        private readonly FileNodeSyncState $fileSyncState,
        private readonly NotificationInboxMarkers $inbox,
        private readonly JmapCapabilitySet $capabilities,
        private readonly DocThreadPushState $docThreads,
    ) {}

    /**
     * The requested types this instance serves, in id order. `null` means `*`.
     * Unknown names and types of a disabled app drop out.
     *
     * @param  list<string>|null  $requested
     * @return list<string>
     */
    public function enabledTypes(?array $requested): array
    {
        $urns = $this->capabilities->supportedUrns();
        $tasksEnabled = (bool) (WgwSettings::normalized()[WgwSettings::TASKS_ENABLED] ?? true);

        $types = [];
        foreach (self::TYPES as $type) {
            if ($requested !== null && ! in_array($type, $requested, true)) {
                continue;
            }
            $source = self::SOURCE_OF_TYPE[$type];
            if (isset(self::SOURCE_URN[$source]) && ! in_array(self::SOURCE_URN[$source], $urns, true)) {
                continue;
            }
            if ($source === 'tasks' && ! $tasksEnabled) {
                continue;
            }
            $types[] = $type;
        }

        return $types;
    }

    /**
     * @param  list<string>  $types  from {@see enabledTypes()}
     * @return array{
     *   states: array<string, array{state: string, hash: string}>,
     *   timings: array<string, float>
     * } timings are milliseconds per state source, plus `caldav` for the read the CalDAV sources share
     */
    public function resolve(string $username, array $types): array
    {
        /** @var array<string, array{state: string, basis: string}> $sources */
        $sources = [];
        $timings = [];
        $states = [];
        $calDav = $this->calDavInstances($username, $types, $timings);
        $this->rootsOfRequest = null;
        foreach ($types as $type) {
            $source = self::SOURCE_OF_TYPE[$type];
            if (! isset($sources[$source])) {
                $started = hrtime(true);
                $sources[$source] = $this->resolveSource($source, $username, $calDav);
                $timings[$source] = (hrtime(true) - $started) / 1e6;
            }
            $states[$type] = [
                'state' => $sources[$source]['state'],
                'hash' => JmapPushEventId::hash($type, $sources[$source]['basis']),
            ];
        }

        return ['states' => $states, 'timings' => $timings];
    }

    /**
     * The accessible instances of every CalDAV kind the types need, in one read. Like the
     * chat channel list, it first gives each of the user's Teams its default channel; like
     * the Notes and Tasks pushes before #2243, it does not provision the user's own collections.
     *
     * @param  list<string>  $types
     * @param  array<string, float>  $timings
     * @return array<string, Collection<int, CalendarInstance>> keyed by the kind's value
     */
    private function calDavInstances(string $username, array $types, array &$timings): array
    {
        $kinds = [];
        foreach ($types as $type) {
            $source = self::SOURCE_OF_TYPE[$type];
            if (isset(self::CALDAV_KIND_OF_SOURCE[$source])) {
                $kinds[$source] = self::CALDAV_KIND_OF_SOURCE[$source];
            }
        }
        if ($kinds === []) {
            return [];
        }

        $started = hrtime(true);
        if (isset($kinds['chat'])) {
            // Same as ChatChannelRepository::accessibleChatInstances(): every Team gets its default channel on read.
            $this->teamChannels->ensureForGroupSlugs($this->groups->allowedGroupSlugs($username));
        }
        $instances = $this->calDavAccess->accessibleInstancesByKind($username, array_values($kinds));
        $timings['caldav'] = (hrtime(true) - $started) / 1e6;

        return $instances;
    }

    /**
     * @param  array<string, Collection<int, CalendarInstance>>  $calDav  from {@see calDavInstances()}
     * @return array{state: string, basis: string}
     */
    private function resolveSource(string $source, string $username, array $calDav): array
    {
        if ($source === 'files') {
            return $this->fileNodeState($username);
        }
        $instances = isset(self::CALDAV_KIND_OF_SOURCE[$source])
            ? $calDav[self::CALDAV_KIND_OF_SOURCE[$source]->value]
            : null;
        $state = match ($source) {
            'notes' => JmapAccountStateCodec::compose($this->notebooks->syncTokensFor($instances ?? [])),
            'calendars' => JmapAccountStateCodec::compose($this->calendars->syncTokensFor($instances ?? [])),
            'contacts' => JmapAccountStateCodec::compose($this->books->syncTokens($username)),
            'chat' => JmapAccountStateCodec::compose(self::channelSyncTokens($instances ?? [])),
            'tasks' => (string) $this->taskLists->changesOf($instances ?? [], null)['newState'],
            'inbox' => (string) $this->inbox->markerFor($username),
            'docthreads' => $this->docThreads->stateFor($this->rootsAndGrantPairs($username)['roots']),
            default => throw new \LogicException('Unknown push state source '.$source),
        };

        return ['state' => $state, 'basis' => $state];
    }

    /**
     * Channel uri => synctoken, as {@see ChatChannelRepository::channelSyncTokens()} builds it.
     *
     * @param  iterable<CalendarInstance>  $instances
     * @return array<string, string>
     */
    private static function channelSyncTokens(iterable $instances): array
    {
        $tokens = [];
        foreach ($instances as $instance) {
            $tokens[(string) $instance->uri] = (string) (int) ($instance->calendar->synctoken ?? 1);
        }

        return $tokens;
    }

    /**
     * @return array{roots: list<string>, grantPairs: string}
     */
    private function rootsAndGrantPairs(string $username): array
    {
        return $this->rootsOfRequest ??= $this->fileAccounts->rootsAndGrantPairs($username);
    }

    /**
     * @return array{state: string, basis: string}
     */
    private function fileNodeState(string $username): array
    {
        ['roots' => $roots, 'grantPairs' => $grantPairs] = $this->rootsAndGrantPairs($username);
        $markers = $this->fileMarkers->markersFor($roots);
        ksort($markers, SORT_STRING);
        // Length-prefixed `root=marker` lines: unambiguous for any byte in a path.
        $basis = '';
        foreach ($markers as $root => $marker) {
            $basis .= strlen((string) $root).':'.$root.'='.$marker."\n";
        }

        // The member grants follow the markers (#1926): hiding one of two grants on one root or
        // changing a grant's access in place moves neither the markers nor change_seq. The basis
        // stays per user; the global seq would wake every browser on any file write.
        $basis .= "grants\n".$grantPairs;

        return [
            'state' => $this->fileSyncState->forGrantPairs($grantPairs),
            'basis' => $basis,
        ];
    }
}

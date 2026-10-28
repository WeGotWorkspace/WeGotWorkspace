<?php

declare(strict_types=1);

namespace App\Services\Jmap\Push;

use App\Services\Calendars\CalendarEventRepository;
use App\Services\Chat\ChatChannelRepository;
use App\Services\Contacts\AddressBookRepository;
use App\Services\Jmap\Capabilities\JmapCapabilitySet;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeRootMarkers;
use App\Services\Jmap\JmapAccountStateCodec;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Notes\NoteRepository;
use App\Services\Notify\NotificationInboxMarkers;
use App\Services\Tasks\TaskListRepository;
use App\Support\WgwSettings;

/**
 * Per-user state of every push type (#1660, docs/architecture/jmap-push.md).
 *
 * Each state comes from the same code as that type's `Foo/get` (or, for
 * tasks, the REST task list state): a composite over the collections the user
 * can access, so a state never covers data the user cannot read. Every read is
 * O(collections or roots the user can see); none scans change rows.
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
    ];

    /** A JMAP-backed source is served only while its capability is enabled. */
    private const SOURCE_URN = [
        'notes' => JmapCapabilities::NOTES,
        'calendars' => JmapCapabilities::CALENDARS,
        'contacts' => JmapCapabilities::CONTACTS,
        'chat' => JmapCapabilities::CHAT,
        'files' => JmapCapabilities::FILENODE,
    ];

    public function __construct(
        private readonly NoteRepository $notes,
        private readonly CalendarEventRepository $events,
        private readonly AddressBookRepository $books,
        private readonly ChatChannelRepository $channels,
        private readonly TaskListRepository $taskLists,
        private readonly FileNodeIndexService $fileIndex,
        private readonly FileNodeAccountSupport $fileAccounts,
        private readonly FileNodeRootMarkers $fileMarkers,
        private readonly NotificationInboxMarkers $inbox,
        private readonly JmapCapabilitySet $capabilities,
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
     * } timings are milliseconds per state source
     */
    public function resolve(string $username, array $types): array
    {
        /** @var array<string, array{state: string, basis: string}> $sources */
        $sources = [];
        $timings = [];
        $states = [];
        foreach ($types as $type) {
            $source = self::SOURCE_OF_TYPE[$type];
            if (! isset($sources[$source])) {
                $started = hrtime(true);
                $sources[$source] = $this->resolveSource($source, $username);
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
     * @return array{state: string, basis: string}
     */
    private function resolveSource(string $source, string $username): array
    {
        if ($source === 'files') {
            return $this->fileNodeState($username);
        }
        $state = match ($source) {
            'notes' => JmapAccountStateCodec::compose($this->notes->notebookSyncTokens($username)),
            'calendars' => JmapAccountStateCodec::compose($this->events->calendarSyncTokens($username)),
            'contacts' => JmapAccountStateCodec::compose($this->books->syncTokens($username)),
            'chat' => JmapAccountStateCodec::compose($this->channels->channelSyncTokens($username)),
            'tasks' => (string) $this->taskLists->changes($username, null)['newState'],
            'inbox' => (string) $this->inbox->markerFor($username),
            default => throw new \LogicException('Unknown push state source '.$source),
        };

        return ['state' => $state, 'basis' => $state];
    }

    /**
     * @return array{state: string, basis: string}
     */
    private function fileNodeState(string $username): array
    {
        $markers = $this->fileMarkers->markersFor($this->fileAccounts->rootsFor($username));
        ksort($markers, SORT_STRING);
        // Length-prefixed `root=marker` lines: unambiguous for any byte in a path.
        $basis = '';
        foreach ($markers as $root => $marker) {
            $basis .= strlen((string) $root).':'.$root.'='.$marker."\n";
        }

        return [
            'state' => (string) $this->fileIndex->currentSeq(),
            'basis' => $basis,
        ];
    }
}

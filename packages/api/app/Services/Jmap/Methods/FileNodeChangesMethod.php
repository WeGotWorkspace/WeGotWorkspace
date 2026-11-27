<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\FileNodes\FileNodeSyncState;
use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Methods\Concerns\ValidatesChangesArguments;

/**
 * FileNode/changes over the global monotonic change sequence with
 * tombstones (design decision 1): rows with change_seq > sinceState,
 * filtered to the account's visible roots, split created/updated/destroyed
 * on created_seq and deleted_at. A sinceState below the tombstone-pruning
 * horizon (or above the counter) → cannotCalculateChanges.
 */
final class FileNodeChangesMethod implements JmapMethodInterface
{
    use ValidatesChangesArguments;

    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
        private readonly FileNodeSyncState $syncState,
    ) {}

    public static function name(): string
    {
        return 'FileNode/changes';
    }

    public static function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    /**
     * The state is `<seq>.<scopeHash>` ({@see FileNodeSyncState}). A Team join or leave, or a
     * grant that was added, revoked, hidden or changed since `sinceState` answers
     * cannotCalculateChanges, so the client resyncs; so does a legacy or grant-only state.
     */
    public function handle(string $username, array $args): array
    {
        $sinceState = $this->sinceState($args);
        $sinceSeq = $this->syncState->sinceSeq($username, $sinceState);

        $roots = $this->accounts->rootsFor($username);
        $delta = $this->index->changesSince($sinceSeq, $roots);
        if ($delta === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => $this->syncState->current($username),
            'hasMoreChanges' => false,
            'created' => $delta['created'],
            'updated' => $delta['updated'],
            'destroyed' => $delta['destroyed'],
        ];
    }
}

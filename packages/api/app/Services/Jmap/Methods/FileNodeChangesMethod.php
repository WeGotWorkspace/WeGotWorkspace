<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
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
    ) {}

    public function name(): string
    {
        return 'FileNode/changes';
    }

    public function capability(): string
    {
        return JmapCapabilities::FILENODE;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $sinceState = $this->sinceState($args);
        if (! ctype_digit($sinceState)) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        $roots = $this->accounts->rootsFor($username);
        $delta = $this->index->changesSince((int) $sinceState, $roots);
        if ($delta === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => (string) $this->index->currentSeq(),
            'hasMoreChanges' => false,
            'created' => $delta['created'],
            'updated' => $delta['updated'],
            'destroyed' => $delta['destroyed'],
        ];
    }
}

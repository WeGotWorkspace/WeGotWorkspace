<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Push\JmapPushEventId;

/**
 * The FileNode state every method returns: `<seq>.<grantHash>` (#1926).
 *
 * `seq` is the global change sequence. `grantHash` is a 128-bit hash of the sorted
 * `(grant id, access)` pairs of the user's live, visible member grants, so a grant that is
 * hidden (Epic #1915), added, revoked or changed in place gives a new state even when no file
 * changed. A delta is only computed from a state with the current `grantHash`; any other state,
 * including a legacy all-digit one, answers `cannotCalculateChanges` and the client resyncs once.
 */
final class FileNodeSyncState
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
    ) {}

    public function current(string $username): string
    {
        return $this->forGrantPairs($this->accounts->memberGrantPairs($username));
    }

    /**
     * {@see current()} from grant pairs the caller already read
     * ({@see FileNodeAccountSupport::rootsAndGrantPairs()}).
     */
    public function forGrantPairs(string $grantPairs): string
    {
        return $this->index->currentSeq().'.'.JmapPushEventId::hash('FileNode', $grantPairs);
    }

    public function grantHash(string $username): string
    {
        return JmapPushEventId::hash('FileNode', $this->accounts->memberGrantPairs($username));
    }

    /**
     * The sequence a delta starts from.
     *
     * @throws JmapMethodException cannotCalculateChanges when the state is malformed, legacy or
     *                             from another set of grants
     */
    public function sinceSeq(string $username, string $state): int
    {
        if (preg_match('/^(\d+)\.([0-9a-f]{32})$/', $state, $matches) !== 1
            || ! hash_equals($this->grantHash($username), $matches[2])) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        return (int) $matches[1];
    }

    /**
     * The sequence of a state this server issued, whatever set of grants it was taken under. A
     * FileNode/query `asOfState` is honoured by sequence alone (#2063): the client's catch-up from
     * that state is what notices a grant change, through `cannotCalculateChanges`.
     *
     * @throws JmapMethodException invalidArguments when the string is not a FileNode state
     */
    public function seqOf(string $state): int
    {
        if (preg_match('/^(\d{1,19})\.[0-9a-f]{32}(?:\.|$)/', $state, $matches) !== 1) {
            throw new JmapMethodException('invalidArguments', 'asOfState must be a FileNode state.');
        }

        return (int) $matches[1];
    }
}

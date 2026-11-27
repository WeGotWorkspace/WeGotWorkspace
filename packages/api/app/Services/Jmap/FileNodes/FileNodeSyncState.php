<?php

declare(strict_types=1);

namespace App\Services\Jmap\FileNodes;

use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\JmapRequestContext;
use App\Services\Jmap\Push\JmapPushEventId;

/**
 * The FileNode state every method returns: `<seq>.<scopeHash>` (#1926, #2063).
 *
 * `seq` is the global change sequence. `scopeHash` is a 128-bit hash of what the user can see
 * apart from file changes: the sorted account roots (own tree plus member Teams) and the sorted
 * `(grant id, access)` pairs of the user's live, visible member grants. Joining or leaving a
 * Team, or a grant that is hidden (Epic #1915), added, revoked or changed in place, gives a new
 * state even when no file changed. A delta is only computed from a state with the current
 * `scopeHash`; any other state, including a legacy all-digit one or one with the grant-only
 * hash of #1926, answers `cannotCalculateChanges` and the client resyncs once.
 */
final class FileNodeSyncState
{
    public function __construct(
        private readonly FileNodeIndexService $index,
        private readonly FileNodeAccountSupport $accounts,
        private readonly JmapRequestContext $context,
    ) {}

    public function current(string $username): string
    {
        return $this->seq().'.'.$this->scopeHash($username);
    }

    /**
     * {@see current()} from the account roots and grant pairs the caller already read
     * ({@see FileNodeAccountSupport::accountRootsAndGrantPairs()}, or
     * {@see FileNodeAccountSupport::rootsAndGrantPairs()} on the push path).
     *
     * @param  list<string>  $accountRoots
     */
    public function forScope(array $accountRoots, string $grantPairs): string
    {
        return $this->seq().'.'.self::hashScope($accountRoots, $grantPairs);
    }

    /** The change sequence, read once per JMAP batch; a write forgets it (FileNodeSequence::next, the dispatcher). */
    private function seq(): int
    {
        return $this->context->remember(FileNodeSequence::REMEMBER_KEY, fn (): int => $this->index->currentSeq());
    }

    public function scopeHash(string $username): string
    {
        ['accountRoots' => $accountRoots, 'grantPairs' => $grantPairs] = $this->accounts->accountRootsAndGrantPairs($username);

        return self::hashScope($accountRoots, $grantPairs);
    }

    /**
     * The sequence a delta starts from.
     *
     * @throws JmapMethodException cannotCalculateChanges when the state is malformed, legacy or
     *                             from another set of roots or grants
     */
    public function sinceSeq(string $username, string $state): int
    {
        if (preg_match('/^(\d+)\.([0-9a-f]{32})$/', $state, $matches) !== 1
            || ! hash_equals($this->scopeHash($username), $matches[2])) {
            throw new JmapMethodException('cannotCalculateChanges', 'Sync state is invalid or expired.');
        }

        return (int) $matches[1];
    }

    /**
     * The sequence of a state this server issued, whatever scope (roots and grants) it was taken under. A
     * FileNode/query `asOfState` is honoured by sequence alone (#2063): the client's catch-up from
     * that state is what notices a scope change, through `cannotCalculateChanges`.
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

    /**
     * Length-prefixed root lines, then the grant pairs. The `roots` header keeps the basis
     * apart from the grant-only basis of #1926, so an old state never matches a new one.
     *
     * @param  list<string>  $accountRoots
     */
    private static function hashScope(array $accountRoots, string $grantPairs): string
    {
        $roots = array_values(array_unique($accountRoots));
        sort($roots, SORT_STRING);
        $basis = "roots\n";
        foreach ($roots as $root) {
            $basis .= strlen($root).':'.$root."\n";
        }

        return JmapPushEventId::hash('FileNode', $basis."grants\n".$grantPairs);
    }
}

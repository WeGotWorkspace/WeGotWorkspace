<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\JmapMethodException;
use App\Services\Jmap\Quota\QuotaRequest;
use App\Services\Jmap\Quota\QuotaStateCodec;

/**
 * Quota/changes (RFC 9425 §4.3). The state encodes every quota's
 * fingerprint, so changes are computed exactly by comparing it with the
 * current quotas. hardLimit follows the disk's free space, so a change by
 * another tenant shows up as an update here (accepted, documented).
 * updatedProperties is null: the server does not track which property moved.
 */
final class QuotaChangesMethod implements JmapMethodInterface
{
    public function __construct(private readonly QuotaRequest $quotas) {}

    public function name(): string
    {
        return 'Quota/changes';
    }

    public function capability(): string
    {
        return JmapCapabilities::QUOTA;
    }

    public function requiresAccountId(): bool
    {
        return true;
    }

    public function handle(string $username, array $args): array
    {
        $sinceState = $args['sinceState'] ?? null;
        if (! is_string($sinceState)) {
            throw new JmapMethodException('invalidArguments', 'sinceState is required.');
        }
        $maxChanges = $args['maxChanges'] ?? null;
        if ($maxChanges !== null && (! is_int($maxChanges) || $maxChanges < 1)) {
            throw new JmapMethodException('invalidArguments', 'maxChanges must be null or a positive integer.');
        }

        $since = QuotaStateCodec::decode($sinceState);
        if ($since === null) {
            throw new JmapMethodException('cannotCalculateChanges', 'Unknown quota state.');
        }

        $current = QuotaStateCodec::fingerprints($this->quotas->quotas($username));

        /** @var list<array{0: 'created'|'updated'|'destroyed', 1: string}> $changes */
        $changes = [];
        foreach ($current as $id => $fingerprint) {
            if (! array_key_exists($id, $since)) {
                $changes[] = ['created', $id];
            } elseif ($since[$id] !== $fingerprint) {
                $changes[] = ['updated', $id];
            }
        }
        foreach (array_keys($since) as $id) {
            if (! array_key_exists($id, $current)) {
                $changes[] = ['destroyed', $id];
            }
        }

        $hasMore = $maxChanges !== null && count($changes) > $maxChanges;
        $taken = $hasMore ? array_slice($changes, 0, $maxChanges) : $changes;

        // An intermediate state: sinceState with only the reported changes
        // applied, so the next call returns the rest.
        $newMap = $since;
        $result = ['created' => [], 'updated' => [], 'destroyed' => []];
        foreach ($taken as [$kind, $id]) {
            $result[$kind][] = $id;
            if ($kind === 'destroyed') {
                unset($newMap[$id]);
            } else {
                $newMap[$id] = $current[$id];
            }
        }

        return [
            'accountId' => $username,
            'oldState' => $sinceState,
            'newState' => QuotaStateCodec::encode($hasMore ? $newMap : $current),
            'hasMoreChanges' => $hasMore,
            'created' => $result['created'],
            'updated' => $result['updated'],
            'destroyed' => $result['destroyed'],
            'updatedProperties' => null,
        ];
    }
}

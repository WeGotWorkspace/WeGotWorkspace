<?php

declare(strict_types=1);

namespace App\Services\Jmap\Methods;

use App\Services\Jmap\JmapCapabilities;
use App\Services\Jmap\Methods\Concerns\HandlesGetArguments;
use App\Services\Jmap\Quota\QuotaRequest;

/**
 * Quota/get (RFC 9425 §4.2): the standard /get over the account's Drive
 * quotas (one per writable root).
 */
final class QuotaGetMethod implements JmapMethodInterface
{
    use HandlesGetArguments;

    public function __construct(private readonly QuotaRequest $quotas) {}

    public function name(): string
    {
        return 'Quota/get';
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
        $ids = $this->requestedIds($args);
        $all = $this->quotas->quotas($username);

        $list = $all;
        $notFound = [];
        if ($ids !== null) {
            $byId = [];
            foreach ($all as $quota) {
                $byId[(string) $quota['id']] = $quota;
            }
            $list = [];
            foreach ($ids as $id) {
                if (isset($byId[$id])) {
                    $list[] = $byId[$id];
                } else {
                    $notFound[] = $id;
                }
            }
        }

        return [
            'accountId' => $username,
            'state' => $this->quotas->state($all),
            'list' => $this->projectProperties($list, $args),
            'notFound' => $notFound,
        ];
    }
}

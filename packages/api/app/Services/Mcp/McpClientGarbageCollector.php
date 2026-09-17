<?php

declare(strict_types=1);

namespace App\Services\Mcp;

use Laravel\Passport\Client;
use Laravel\Passport\Passport;

final class McpClientGarbageCollector
{
    public function prune(): int
    {
        $ttlHours = (int) config('mcp.cimd.client_ttl_hours', 24);
        $cutoff = now()->subHours(max(1, $ttlHours));
        $deleted = 0;

        $stale = Passport::client()->newQuery()
            ->where(function ($query): void {
                $query->whereNotNull('cimd_url')
                    ->orWhereNull('owner_id');
            })
            ->where('created_at', '<', $cutoff)
            ->get();

        foreach ($stale as $client) {
            if (! $client instanceof Client) {
                continue;
            }
            $hasTokens = Passport::token()->newQuery()
                ->where('client_id', $client->getKey())
                ->where('revoked', false)
                ->where('expires_at', '>', now())
                ->exists();
            if ($hasTokens) {
                continue;
            }
            $fetchedAt = $client->getAttribute('cimd_fetched_at');
            if ($fetchedAt !== null && $fetchedAt > $cutoff) {
                continue;
            }
            $client->delete();
            $deleted++;
        }

        return $deleted;
    }
}

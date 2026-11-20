<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * The `RtcRoom` push state (#2294) reads, per push request, the rooms where the caller has a
 * live peer: `owner_user = ? AND seen_at >= ?`. Peer tables only had `room` and `seen_at`
 * indexes, so that read scanned every live peer on the server.
 */
return new class extends WgwMigration
{
    private const PEER_TABLES = ['meet_peers', 'collab_peers', 'principal_peers'];

    public function up(): void
    {
        foreach (self::PEER_TABLES as $table) {
            if (! $this->wgwHasTable($table) || ! $this->wgwHasColumn($table, 'owner_user') || $this->hasIndex($table)) {
                continue;
            }
            $this->wgw()->table($table, function (Blueprint $blueprint) use ($table): void {
                $blueprint->index(['owner_user', 'seen_at'], self::indexName($table));
            });
        }
    }

    public function down(): void
    {
        foreach (self::PEER_TABLES as $table) {
            if (! $this->wgwHasTable($table) || ! $this->hasIndex($table)) {
                continue;
            }
            $this->wgw()->table($table, function (Blueprint $blueprint) use ($table): void {
                $blueprint->dropIndex(self::indexName($table));
            });
        }
    }

    private static function indexName(string $table): string
    {
        return 'idx_'.$table.'_owner_seen';
    }

    private function hasIndex(string $table): bool
    {
        return in_array(self::indexName($table), collect($this->wgw()->getIndexes($table))->pluck('name')->all(), true);
    }
};

<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * The single schema change for the real-time hardening programme (contract C9).
 *
 * Peer rows gain the advertised wire capabilities and the measured network
 * class; collab peers also gain the join-computed access right (default
 * `read`, so a row that skipped the join write can never edit) and the
 * browser token. Pruning moves off full scans onto `seen_at` / `created_at`
 * indexes. `collab_peers` and `collab_messages` are volatile and truncated
 * because the room-key semantics change in the same programme. The two new
 * tables carry relay decisions and anonymous session samples, both pruned
 * after 30 days.
 */
return new class extends WgwMigration
{
    private const PEER_TABLES = ['meet_peers', 'collab_peers', 'principal_peers'];

    private const MESSAGE_TABLES = ['meet_messages', 'collab_messages', 'principal_messages'];

    public function up(): void
    {
        foreach (self::PEER_TABLES as $table) {
            $this->addPeerColumns($table);
            $this->addIndex($table, 'seen_at', $this->seenAtIndexName($table));
        }

        $this->addCollabPeerColumns();

        foreach (self::MESSAGE_TABLES as $table) {
            $this->addIndex($table, 'created_at', $this->createdAtIndexName($table));
        }

        $this->truncateCollabSignaling();
        $this->createRelayEvents();
        $this->createSessionMetrics();
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('rtc_session_metrics');
        $this->wgw()->dropIfExists('rtc_relay_events');

        foreach (self::MESSAGE_TABLES as $table) {
            $this->dropIndex($table, $this->createdAtIndexName($table));
        }

        foreach (['access', 'browser_id'] as $column) {
            $this->dropColumn('collab_peers', $column);
        }

        foreach (self::PEER_TABLES as $table) {
            $this->dropIndex($table, $this->seenAtIndexName($table));
            foreach (['caps', 'net'] as $column) {
                $this->dropColumn($table, $column);
            }
        }
    }

    private function addPeerColumns(string $table): void
    {
        if (! $this->wgwHasTable($table)) {
            return;
        }

        $missing = array_values(array_filter(
            ['caps', 'net'],
            fn (string $column): bool => ! $this->wgwHasColumn($table, $column),
        ));
        if ($missing === []) {
            return;
        }

        $this->wgw()->table($table, function (Blueprint $blueprint) use ($missing): void {
            if (in_array('caps', $missing, true)) {
                // Comma-separated wire capabilities as advertised at join.
                $blueprint->string('caps', 190)->default('');
            }
            if (in_array('net', $missing, true)) {
                $blueprint->string('net', 16)->default('');
            }
        });
    }

    private function addCollabPeerColumns(): void
    {
        if (! $this->wgwHasTable('collab_peers')) {
            return;
        }

        $missing = array_values(array_filter(
            ['access', 'browser_id'],
            fn (string $column): bool => ! $this->wgwHasColumn('collab_peers', $column),
        ));
        if ($missing === []) {
            return;
        }

        $this->wgw()->table('collab_peers', function (Blueprint $blueprint) use ($missing): void {
            if (in_array('access', $missing, true)) {
                // Fail-closed: only the join path writes the computed right.
                $blueprint->string('access', 8)->default('read');
            }
            if (in_array('browser_id', $missing, true)) {
                $blueprint->string('browser_id', 32)->default('');
            }
        });
    }

    private function truncateCollabSignaling(): void
    {
        foreach (['collab_peers', 'collab_messages'] as $table) {
            if ($this->wgwHasTable($table)) {
                $this->wgw()->getConnection()->table($table)->delete();
            }
        }
    }

    private function createRelayEvents(): void
    {
        if ($this->wgwHasTable('rtc_relay_events')) {
            return;
        }

        $this->wgw()->create('rtc_relay_events', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('created_at');
            $table->string('channel', 16);
            $table->string('actor', 190);
            $table->string('reason', 16);
            $table->string('outcome', 16);
            $table->index('created_at', 'idx_rtc_relay_events_created');
        });
    }

    private function createSessionMetrics(): void
    {
        if ($this->wgwHasTable('rtc_session_metrics')) {
            return;
        }

        // Anonymous session samples for the real-time health page: no addresses,
        // room names, or user ids.
        $this->wgw()->create('rtc_session_metrics', function (Blueprint $table): void {
            $table->id();
            $table->unsignedBigInteger('created_at');
            $table->string('channel', 16);
            $table->unsignedInteger('join_ms')->default(0);
            $table->string('candidate_type', 16)->default('');
            $table->unsignedInteger('failed_pairs')->default(0);
            $table->unsignedInteger('ice_restarts')->default(0);
            $table->boolean('http_fallback')->default(false);
            $table->unsignedInteger('poll_rtt_ms')->default(0);
            $table->string('net', 16)->default('');
            $table->index('created_at', 'idx_rtc_session_metrics_created');
        });
    }

    private function addIndex(string $table, string $column, string $name): void
    {
        if (! $this->wgwHasTable($table) || ! $this->wgwHasColumn($table, $column) || $this->hasIndex($table, $name)) {
            return;
        }

        $this->wgw()->table($table, function (Blueprint $blueprint) use ($column, $name): void {
            $blueprint->index($column, $name);
        });
    }

    private function dropIndex(string $table, string $name): void
    {
        if (! $this->wgwHasTable($table) || ! $this->hasIndex($table, $name)) {
            return;
        }

        $this->wgw()->table($table, function (Blueprint $blueprint) use ($name): void {
            $blueprint->dropIndex($name);
        });
    }

    private function dropColumn(string $table, string $column): void
    {
        if (! $this->wgwHasTable($table) || ! $this->wgwHasColumn($table, $column)) {
            return;
        }

        $this->wgw()->table($table, function (Blueprint $blueprint) use ($column): void {
            $blueprint->dropColumn($column);
        });
    }

    private function hasIndex(string $table, string $name): bool
    {
        return in_array($name, collect($this->wgw()->getIndexes($table))->pluck('name')->all(), true);
    }

    private function seenAtIndexName(string $table): string
    {
        return 'idx_'.str_replace('_peers', '', $table).'_peers_seen';
    }

    private function createdAtIndexName(string $table): string
    {
        return 'idx_'.str_replace('_messages', '', $table).'_msg_created';
    }
};

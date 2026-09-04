<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Signaling tables for principal presence rooms (`p_` room kind). Peer ids are
 * `{username-prefix}-{hex}` (up to 80 chars) instead of collab's 16-hex ids.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('principal_peers')) {
            $this->wgw()->create('principal_peers', function (Blueprint $table): void {
                $table->string('room', 190);
                $table->string('peer_id', 80);
                $table->string('name', 64)->default('');
                $table->string('owner_user', 190)->default('');
                $table->unsignedBigInteger('seen_at');
                $table->primary(['room', 'peer_id']);
                $table->index('room', 'idx_principal_peers_room');
            });
        }

        if (! $this->wgwHasTable('principal_messages')) {
            $this->wgw()->create('principal_messages', function (Blueprint $table): void {
                $table->id();
                $table->string('room', 190);
                $table->string('from_peer', 80);
                $table->string('to_peer', 80);
                $table->string('type', 16);
                $table->longText('payload');
                $table->unsignedBigInteger('created_at');
                $table->index(['room', 'to_peer', 'id'], 'idx_principal_msg_target');
            });
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('principal_messages');
        $this->wgw()->dropIfExists('principal_peers');
    }
};

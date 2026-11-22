<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * The canonical room of a collab peer (#2287). `collab_peers.room` is only the hash of the
 * drive path or note UID (`CollabRoomPolicy::roomKey`), and authorization runs on the
 * canonical room. Behind the push doorbell a quiet room does not poll, so the push read
 * re-checks the peer's access on this column instead. Rows from before it have none and are
 * not kept alive by the push read: they expire, and the room rejoins on its own poll.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('collab_peers') || $this->wgwHasColumn('collab_peers', 'room_path')) {
            return;
        }
        $this->wgw()->table('collab_peers', function (Blueprint $table): void {
            $table->text('room_path')->nullable();
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('collab_peers') || ! $this->wgwHasColumn('collab_peers', 'room_path')) {
            return;
        }
        $this->wgw()->table('collab_peers', function (Blueprint $table): void {
            $table->dropColumn('room_path');
        });
    }
};

<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('meet_peers') || $this->wgwHasColumn('meet_peers', 'admitted')) {
            return;
        }

        // Server-recorded knock admission for channel-linked rooms (Epic #701
        // chunk H): set when a channel member sends an admit control message
        // (MeetSignalingService::chat), checked when the knocker re-joins
        // without the knock name prefix. The flag lives on the peer row so it
        // dies with the peer (leave/timeout) and every re-knock starts
        // unadmitted. Collab/principal peer tables never use it.
        $this->wgw()->table('meet_peers', function (Blueprint $table): void {
            $table->boolean('admitted')->default(false);
        });
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('meet_peers') || ! $this->wgwHasColumn('meet_peers', 'admitted')) {
            return;
        }

        $this->wgw()->table('meet_peers', function (Blueprint $table): void {
            $table->dropColumn('admitted');
        });
    }
};

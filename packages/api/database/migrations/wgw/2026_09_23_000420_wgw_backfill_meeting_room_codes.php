<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Meet\MeetMeetingRoomCodeBackfill;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('chat_channel_meta')) {
            return;
        }

        // Meetings created before room codes existed are `chat-{slug}` with
        // room_code null. Assign a code so the host can share a guest link.
        // The collection id is left alone; the slug URL stays members-only.
        app(MeetMeetingRoomCodeBackfill::class)->assignMissing();
    }

    public function down(): void
    {
        // Data migration — assigned codes remain after rollback.
    }
};

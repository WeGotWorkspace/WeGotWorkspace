<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || $this->wgwHasTable('chat_channel_meta')) {
            return;
        }

        // Chat channel fields that do not fit CalDAV rows (precedent: note_stars).
        // kind/topic per channel; room_code stores the meet_reservations linkage
        // for meeting channels — the reservation wiring itself is a later chunk.
        $this->wgw()->create('chat_channel_meta', function (Blueprint $table): void {
            $table->unsignedInteger('calendarid')->primary();
            $table->string('kind', 16)->default('channel');
            $table->string('topic', 1024)->nullable();
            $table->string('room_code', 64)->nullable();
            $table->index('kind');
            $table->foreign('calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('chat_channel_meta');
    }
};

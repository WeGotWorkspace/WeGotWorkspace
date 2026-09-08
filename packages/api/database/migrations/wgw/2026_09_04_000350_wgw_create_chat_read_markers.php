<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || $this->wgwHasTable('chat_read_markers')) {
            return;
        }

        // Per-user read position in a channel. Ordering source of truth is
        // (created_ts, uid): unread = messages with (created_ts, uid) greater
        // than (last_read_ts, last_read_uid), own messages excluded. The ULID
        // is only the tiebreak — never the sole comparator.
        $this->wgw()->create('chat_read_markers', function (Blueprint $table): void {
            $table->id();
            $table->string('username', 190);
            $table->unsignedInteger('calendarid');
            $table->unsignedBigInteger('last_read_ts');
            $table->string('last_read_uid', 26);
            $table->unique(['username', 'calendarid']);
            $table->foreign('calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('chat_read_markers');
    }
};

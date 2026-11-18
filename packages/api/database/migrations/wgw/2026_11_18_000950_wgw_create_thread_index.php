<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

/**
 * Side index for entries in the shared thread pools (#2173,
 * docs/architecture/threads.md). One row per VJOURNAL entry. Generic over
 * subject types: no column names a task. Nothing writes it yet; the shared
 * thread service (#2173 chunk B) fills it.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || $this->wgwHasTable('thread_index')) {
            return;
        }

        $this->wgw()->create('thread_index', function (Blueprint $table): void {
            $table->id();
            $table->string('uid', 26);
            $table->unsignedInteger('pool_calendarid');
            $table->string('subject_type', 32);
            // The scope plus the subject id; the current key of a thread.
            $table->string('subject_key', 320);
            // Where the audience is set (a task list's calendarid for tasks).
            $table->string('subject_scope', 64);
            $table->string('kind', 16);
            $table->string('parent_uid', 26)->nullable();
            $table->string('author', 255);
            // Server arrival time; threads sort and page by (created_at, uid).
            $table->dateTime('created_at', 6);
            $table->unsignedBigInteger('modseq');
            $table->string('activity_field', 64)->nullable();
            $table->unique('uid');
            // Listing one thread. utf8mb4: 4 + 1280 + 8 + 104 bytes stays under MySQL's 3072-byte cap.
            $table->index(['pool_calendarid', 'subject_key', 'created_at', 'uid'], 'thread_index_thread_order');
            // The ThreadEntry push state: max(modseq) per readable scope.
            $table->index(['subject_type', 'subject_scope', 'modseq'], 'thread_index_push_state');
            $table->foreign('pool_calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('thread_index');
    }
};

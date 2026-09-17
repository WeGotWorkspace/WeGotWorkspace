<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;

return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendars') || $this->wgwHasTable('docs_thread_index')) {
            return;
        }

        $this->wgw()->create('docs_thread_index', function (Blueprint $table): void {
            $table->id();
            $table->unsignedInteger('calendarid');
            $table->string('uid', 26);
            // 512 keeps path index under MySQL utf8mb4 index limit (3072 bytes).
            $table->string('doc_path', 512);
            $table->string('kind', 16);
            $table->string('parent_uid', 26)->nullable();
            $table->string('change_id', 128)->nullable();
            $table->unique('uid');
            // Hot path (assembleThreads / uidsOnPath) always filters both columns.
            // utf8mb4: unsigned int + varchar(512) stays under MySQL's 3072-byte cap.
            $table->index(['calendarid', 'doc_path']);
            // retargetPath / dropPath look up by doc_path without calendarid.
            $table->index('doc_path');
            $table->index(['calendarid', 'change_id']);
            $table->foreign('calendarid')
                ->references('id')
                ->on('calendars')
                ->onDelete('cascade');
        });
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('docs_thread_index');
    }
};

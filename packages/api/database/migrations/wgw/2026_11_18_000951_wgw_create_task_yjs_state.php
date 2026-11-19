<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Yjs state for the live title and description of one task (#2208), keyed by
 * calendarobjects.id and the VTODO's own UID, so a second VTODO a native
 * client adds to the file keeps its own row. `state` is widened to
 * MEDIUMBLOB on MySQL like `note_yjs_state`.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        if (! $this->wgwHasTable('task_yjs_state')) {
            $this->wgw()->create('task_yjs_state', function (Blueprint $table): void {
                $table->id();
                $table->unsignedInteger('calendar_object_id');
                $table->string('vtodo_uid', 200);
                $table->binary('state');
                $table->string('object_etag', 255);
                $table->string('content_etag', 64);
                $table->timestamps();
                $table->unique(['calendar_object_id', 'vtodo_uid']);
                $table->foreign('calendar_object_id')
                    ->references('id')
                    ->on('calendarobjects')
                    ->onDelete('cascade');
            });
        }

        if (DB::connection('wgw')->getDriverName() === 'mysql') {
            DB::connection('wgw')->statement('ALTER TABLE task_yjs_state MODIFY state MEDIUMBLOB NOT NULL');
        }
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('task_yjs_state');
    }
};

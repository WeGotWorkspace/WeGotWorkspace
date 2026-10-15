<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Yjs state for a note, keyed by calendarobjects.id so a notebook move keeps it.
 *
 * `calendardata` is MEDIUMBLOB in the Sabre bundle applied by
 * 2026_06_06_000030_wgw_apply_sabre_sql_bundles.php. Laravel's binary() column
 * is only a 64 KB BLOB on MySQL, so this migration widens `state` the same way
 * 2026_07_02_000120 alters a column with DB::statement. SQLite BLOB has no
 * 64 KB class; the create type is already unbounded there.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        if (! $this->wgwHasTable('note_yjs_state')) {
            $this->wgw()->create('note_yjs_state', function (Blueprint $table): void {
                $table->id();
                $table->unsignedInteger('calendar_object_id');
                $table->string('note_uid', 200);
                $table->binary('state');
                $table->string('object_etag', 255);
                $table->timestamps();
                $table->unique('calendar_object_id');
                $table->index('note_uid');
                $table->foreign('calendar_object_id')
                    ->references('id')
                    ->on('calendarobjects')
                    ->onDelete('cascade');
            });
        }

        $this->widenStateColumn();
    }

    public function down(): void
    {
        $this->wgw()->dropIfExists('note_yjs_state');
    }

    private function widenStateColumn(): void
    {
        if (DB::connection('wgw')->getDriverName() !== 'mysql' || ! $this->wgwHasTable('note_yjs_state')) {
            return;
        }

        $column = DB::connection('wgw')->selectOne(
            'select DATA_TYPE as data_type from information_schema.COLUMNS where TABLE_SCHEMA = database() and TABLE_NAME = ? and COLUMN_NAME = ?',
            ['note_yjs_state', 'state'],
        );
        $type = is_object($column) ? strtolower((string) ($column->data_type ?? '')) : '';
        if ($type === 'mediumblob') {
            return;
        }

        DB::connection('wgw')->statement(
            'ALTER TABLE note_yjs_state MODIFY state MEDIUMBLOB NOT NULL',
        );
    }
};

<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Notes\NoteYjsProjection;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;

/**
 * Hash of the SUMMARY and DESCRIPTION the Yjs row was written from.
 * The next read compares it when the journal ETag has moved on.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable('note_yjs_state')) {
            return;
        }

        if (! $this->wgwHasColumn('note_yjs_state', 'content_etag')) {
            $this->wgw()->table('note_yjs_state', function (Blueprint $table): void {
                $table->string('content_etag', 40)->nullable();
            });
        }

        $this->backfillMissingHashes();
    }

    public function down(): void
    {
        if (! $this->wgwHasTable('note_yjs_state') || ! $this->wgwHasColumn('note_yjs_state', 'content_etag')) {
            return;
        }

        $this->wgw()->table('note_yjs_state', function (Blueprint $table): void {
            $table->dropColumn('content_etag');
        });
    }

    private function backfillMissingHashes(): void
    {
        $converter = new NoteJournalConverter;
        $rows = DB::connection('wgw')->table('note_yjs_state')
            ->whereNull('content_etag')
            ->get(['id', 'calendar_object_id', 'note_uid']);

        foreach ($rows as $row) {
            $object = DB::connection('wgw')->table('calendarobjects')
                ->where('id', $row->calendar_object_id)
                ->first(['calendardata']);
            if ($object === null) {
                continue;
            }

            $ics = $object->calendardata;
            if (is_resource($ics)) {
                $contents = stream_get_contents($ics);
                $ics = is_string($contents) ? $contents : '';
            }
            $note = $converter->fromIcs(is_string($ics) ? $ics : '', (string) $row->note_uid);
            $body = is_string($note['body'] ?? null) ? $note['body'] : '';
            $title = $note['title'] ?? null;

            DB::connection('wgw')->table('note_yjs_state')->where('id', $row->id)->update([
                'content_etag' => NoteYjsProjection::hashContent($body, is_string($title) ? $title : null),
            ]);
        }
    }
};

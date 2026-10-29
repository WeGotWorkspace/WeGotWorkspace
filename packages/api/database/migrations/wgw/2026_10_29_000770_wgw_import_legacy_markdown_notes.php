<?php

declare(strict_types=1);

use App\Database\Migrations\WgwMigration;
use App\Services\Notes\LegacyNoteImportLedger;
use App\Services\Notes\NotesFileMigrator;
use App\Services\Update\UpdateStateStore;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Log;

/**
 * Notes from v0.1.96 and older are Markdown files under `.notes/`. Only
 * `wgw:notes:migrate-files` imported them, and ZIP hosts cannot run it, so
 * every update now imports them once (#1773). The files stay on disk, and so
 * do collaborative-edit sidecars, as the backup.
 */
return new class extends WgwMigration
{
    public function up(): void
    {
        if (! $this->wgwHasTable(LegacyNoteImportLedger::TABLE)) {
            $this->wgw()->create(LegacyNoteImportLedger::TABLE, function (Blueprint $table): void {
                $table->char('path_hash', 64)->primary();
                $table->text('source_path');
                $table->string('note_uid', 255);
                $table->unsignedBigInteger('imported_at');
            });
        }
        if (! $this->wgwHasTable('users') || ! $this->wgwHasTable('calendarobjects')) {
            return;
        }

        // A failure here must not block the migrations after it: the files
        // stay on disk and the command can import them later.
        try {
            $result = app(NotesFileMigrator::class)->migrate(discardYjs: false);
        } catch (Throwable $e) {
            Log::error('Could not import the Markdown notes from before v0.1.97.', ['exception' => $e]);
            $this->appendUpdateLog('Importing Markdown notes from before v0.1.97 failed: '.$e->getMessage());

            return;
        }
        if ($result['mapped'] === 0) {
            return;
        }
        $this->appendUpdateLog(sprintf(
            'Imported %d Markdown note(s) from before v0.1.97; %d were already imported; %d skipped.',
            $result['imported'],
            $result['alreadyImported'],
            $result['skipped'],
        ));
        foreach ($result['notices'] as $notice) {
            $this->appendUpdateLog('Notes import: '.$notice);
        }
    }

    public function down(): void
    {
        // Data migration — imported notes stay. The ledger stays so a rerun
        // does not import them twice.
    }

    private function appendUpdateLog(string $message): void
    {
        try {
            app(UpdateStateStore::class)->appendLog($message);
        } catch (Throwable) {
            Log::warning($message);
        }
    }
};

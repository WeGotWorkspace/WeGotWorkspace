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

        // The in-app updater reaches this file without a raised time limit.
        @set_time_limit(0);
        // A file that fails is skipped with a notice inside the import and
        // tried again by the next run. Anything that escapes is not about one
        // file (the database, the data directory), so the migration stays
        // pending and a later request retries it; the import is idempotent.
        try {
            $result = app(NotesFileMigrator::class)->migrate(discardYjs: false);
        } catch (Throwable $e) {
            Log::error('Could not import the Markdown notes from before v0.1.97.', ['exception' => $e]);
            $this->appendUpdateLog('Importing Markdown notes from before v0.1.97 failed: '.$e->getMessage());

            throw $e;
        }
        if ($result['mapped'] === 0 && $result['notices'] === []) {
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
        if ($result['skipped'] > 0 || $this->hasListingNotice($result['notices'])) {
            // Recorded as run, so a file that can never be read does not hold
            // every later migration; the command picks the rest up.
            $this->appendUpdateLog('Some Markdown notes were not imported (see above). Once they are readable, run `php artisan wgw:notes:migrate-files` to import them.');
        }
    }

    public function down(): void
    {
        // Data migration — imported notes stay. The ledger stays so a rerun
        // does not import them twice.
    }

    /**
     * @param  list<string>  $notices
     */
    private function hasListingNotice(array $notices): bool
    {
        foreach ($notices as $notice) {
            if (str_starts_with($notice, 'could not list ') || str_starts_with($notice, 'skipped symbolic link: ')) {
                return true;
            }
        }

        return false;
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

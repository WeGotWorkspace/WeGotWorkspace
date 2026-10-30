<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Models\DriveStarredItem;
use App\Models\NoteStar;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\LegacyNoteImportLedger;
use App\Services\Notes\NotebookRepository;
use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Notes\NoteRepository;
use App\Storage\WgwStorage;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\NotesTestFixtures;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Notes from v0.1.96 and older are Markdown files under `.notes/`. The update
 * imports them on its own, exactly once, however often the import runs
 * (#1773).
 */
final class LegacyNotesImportTest extends WgwDatabaseTestCase
{
    use NotesTestFixtures;
    use SeedsWgwIdentity;

    private const MIGRATION = 'migrations/wgw/2026_10_29_000770_wgw_import_legacy_markdown_notes.php';

    private int $journalCountBefore = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpNotesFixtures();
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/team', 'Team');
    }

    protected function tearDown(): void
    {
        $this->tearDownNotesFixtures();
        parent::tearDown();
    }

    public function test_the_update_imports_legacy_notes_with_their_details_and_keeps_the_files(): void
    {
        $this->putLegacyNotes();

        $this->runMigration();

        $drafts = $this->notesIn('Drafts');
        $welcome = $drafts->firstWhere('title', 'Welcome');
        $this->assertIsArray($welcome);
        $this->assertSame('Hello body', $welcome['body']);
        $this->assertContains('focus', $welcome['categories']);
        $this->assertTrue($welcome['starred']);
        $this->assertNotNull($this->notesIn('Drafts', 'CANCELLED')->firstWhere('title', 'Old'));
        $this->assertNotNull($this->notesIn('Roadmap', groupSlug: 'team')->firstWhere('title', 'Team'));

        $disk = app(WgwStorage::class)->files();
        $this->assertTrue($disk->fileExists('users/bob/.notes/Drafts/welcome.md'), 'The source file stays as a backup.');
        $this->assertTrue($disk->fileExists('users/bob/.notes/Drafts/.welcome.md.yjs'), 'Unsaved collaborative edits stay on disk.');
    }

    public function test_running_the_import_again_does_not_duplicate_notes(): void
    {
        $this->putLegacyNotes();

        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));
        $afterFirst = $this->journalCount();
        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));
        $this->runMigration();

        $this->assertSame(3, $afterFirst - $this->journalCountBefore);
        $this->assertSame($afterFirst, $this->journalCount());
        $this->assertCount(1, $this->notesIn('Drafts')->where('title', 'Welcome'));
    }

    public function test_the_command_after_the_update_adds_nothing(): void
    {
        $this->putLegacyNotes();

        $this->runMigration();
        $afterUpdate = $this->journalCount();
        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));

        $this->assertSame(3, $afterUpdate - $this->journalCountBefore);
        $this->assertSame($afterUpdate, $this->journalCount());
    }

    public function test_a_deleted_imported_note_does_not_come_back(): void
    {
        $this->putLegacyNotes();
        $this->runMigration();
        $welcome = $this->notesIn('Drafts')->firstWhere('title', 'Welcome');
        $this->assertIsArray($welcome);
        app(NoteRepository::class)->delete('bob', (string) $welcome['id'], null, requirePrecondition: false);

        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));

        $this->assertNull($this->notesIn('Drafts')->firstWhere('title', 'Welcome'));
    }

    public function test_a_note_unstarred_after_the_import_stays_unstarred(): void
    {
        $this->putLegacyNotes();
        $this->runMigration();
        $this->assertSame(1, NoteStar::query()->where('username', 'bob')->count());
        NoteStar::query()->where('username', 'bob')->delete();

        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));

        $this->assertSame(0, NoteStar::query()->where('username', 'bob')->count());
    }

    /**
     * Before #1773 the command gave every note a random UID and kept no
     * record, so the update must recognise notes it already imported.
     */
    public function test_notes_the_earlier_command_imported_are_not_imported_again(): void
    {
        $this->putLegacyNotes();
        $drafts = app(NotebookRepository::class)->findOrCreateNamed('bob', 'Drafts');
        app(NoteRepository::class)->create('bob', [
            'notebookId' => $drafts['id'],
            'title' => 'Welcome',
            'body' => 'Hello body',
            'categories' => ['focus'],
        ], allowStoredTags: true);
        $before = $this->journalCount();

        $this->runMigration();

        $this->assertCount(1, $this->notesIn('Drafts')->where('title', 'Welcome'));
        $this->assertSame($before + 2, $this->journalCount(), 'Only the two notes not imported before are added.');
    }

    public function test_a_file_that_cannot_be_read_does_not_stop_the_others(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('root can read a file without permissions.');
        }
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/.notes/Drafts/a-broken.md', (new NoteMarkdownCodec)->serialize('Broken', [], 'x'));
        chmod($disk->path('users/bob/.notes/Drafts/a-broken.md'), 0);
        $this->putLegacyNotes();

        try {
            $this->runMigration();
        } finally {
            chmod($disk->path('users/bob/.notes/Drafts/a-broken.md'), 0644);
        }

        $this->assertSame(3, $this->journalCount() - $this->journalCountBefore);
        $this->assertNotNull($this->notesIn('Drafts')->firstWhere('title', 'Welcome'));
        $this->assertStringContainsString('import failed /users/bob/.notes/Drafts/a-broken.md', $this->updateLog());
    }

    public function test_a_symbolic_link_under_notes_is_skipped_and_the_rest_imported(): void
    {
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/elsewhere.md', (new NoteMarkdownCodec)->serialize('Linked', [], 'x'));
        $this->putLegacyNotes();
        symlink($disk->path('users/bob/elsewhere.md'), $disk->path('users/bob/.notes/Drafts').'/a-link.md');

        $this->runMigration();

        $this->assertSame(3, $this->journalCount() - $this->journalCountBefore);
        $this->assertStringContainsString('/users/bob/.notes/Drafts/a-link.md', $this->updateLog());
    }

    /**
     * A run cut off between creating a note and recording it: the next run
     * records it and still copies its Drive star.
     */
    public function test_an_interrupted_run_keeps_the_star(): void
    {
        $this->putLegacyNotes();
        $drafts = app(NotebookRepository::class)->findOrCreateNamed('bob', 'Drafts');
        app(NoteRepository::class)->create('bob', [
            'uid' => app(LegacyNoteImportLedger::class)->uidFor('/users/bob/.notes/Drafts/welcome.md'),
            'notebookId' => $drafts['id'],
            'title' => 'Welcome',
            'body' => 'Hello body',
            'categories' => ['focus'],
        ], allowStoredTags: true);

        $this->runMigration();

        $welcome = $this->notesIn('Drafts')->where('title', 'Welcome');
        $this->assertCount(1, $welcome);
        $this->assertTrue($welcome->first()['starred']);
    }

    public function test_the_command_keeps_collaborative_edit_sidecars_unless_asked(): void
    {
        $this->putLegacyNotes();
        $disk = app(WgwStorage::class)->files();

        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files'));
        $this->assertTrue($disk->fileExists('users/bob/.notes/Drafts/.welcome.md.yjs'));

        $this->assertSame(0, Artisan::call('wgw:notes:migrate-files', ['--discard-yjs' => true]));
        $this->assertFalse($disk->fileExists('users/bob/.notes/Drafts/.welcome.md.yjs'));
    }

    public function test_the_update_log_names_notes_that_were_shared_in_drive(): void
    {
        $this->putLegacyNotes();
        DB::connection('wgw')->table('drive_shares')->insert([
            'id' => (string) Str::uuid(),
            'path' => '/users/bob/.notes/Drafts',
            'owner_username' => 'bob',
            'kind' => 'people',
            'default_access' => 'view',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->runMigration();

        $this->assertStringContainsString(
            'shared in Drive as /users/bob/.notes/Drafts; the imported note is not shared: /users/bob/.notes/Drafts/welcome.md',
            $this->updateLog(),
        );
    }

    private function putLegacyNotes(): void
    {
        $codec = new NoteMarkdownCodec;
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/.notes/Drafts/welcome.md', $codec->serialize('Welcome', ['focus'], 'Hello body'));
        $disk->put('users/bob/.notes/.archive/Drafts/old.md', $codec->serialize('Old', [], 'Archived body'));
        $disk->put('users/bob/.notes/Drafts/.welcome.md.yjs', 'yjs-bytes');
        $disk->put('groups/team/.notes/Roadmap/team-note.md', $codec->serialize('Team', [], 'Group body'));
        DriveStarredItem::query()->create([
            'username' => 'bob',
            'path' => '/users/bob/.notes/Drafts/welcome.md',
            'created_at' => time(),
        ]);
        $this->journalCountBefore = $this->journalCount();
    }

    private function runMigration(): void
    {
        $migration = require database_path(self::MIGRATION);
        $migration->up();
    }

    private function updateLog(): string
    {
        return (string) app(WgwStorage::class)->data()->get('updates/process.log');
    }

    private function journalCount(): int
    {
        return CalendarObject::query()->where('componenttype', 'VJOURNAL')->count();
    }

    /**
     * @return Collection<int, array<string, mixed>>
     */
    private function notesIn(string $notebookName, ?string $status = null, ?string $groupSlug = null): Collection
    {
        $client = $this->withBearer($this->issueBearerTokenFor('bob'));
        $notebook = collect($client->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))->first(
            fn (array $row): bool => ($row['name'] ?? '') === $notebookName && ($row['groupSlug'] ?? null) === $groupSlug,
        );
        $this->assertIsArray($notebook, 'Notebook missing: '.$notebookName);
        $query = '/api/v1/notes/items?notebookId='.$notebook['id'].($status !== null ? '&status='.$status : '');

        return collect($client->getJson($query)->assertOk()->json('list'));
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Models\DriveStarredItem;
use App\Models\NoteStar;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\NotebookRepository;
use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Notes\NoteRepository;
use App\Storage\WgwStorage;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Artisan;
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

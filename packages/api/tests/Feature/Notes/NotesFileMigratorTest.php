<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\DriveStarredItem;
use App\Models\NoteStar;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\NoteMarkdownCodec;
use App\Services\Notes\NotesFileMigrator;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\Artisan;
use Tests\Support\NotesTestFixtures;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class NotesFileMigratorTest extends WgwDatabaseTestCase
{
    use NotesTestFixtures;
    use SeedsWgwIdentity;

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

    public function test_imports_markdown_archive_stars_and_group_home(): void
    {
        $codec = new NoteMarkdownCodec;
        $disk = app(WgwStorage::class)->files();
        $disk->put('users/bob/.notes/Drafts/welcome.md', $codec->serialize('Welcome', ['focus'], 'Hello body'));
        $disk->put('users/bob/.notes/.archive/Drafts/old.md', $codec->serialize('Old', [], 'Archived body'));
        $disk->put('users/bob/.notes/Drafts/.welcome.md.yjs', 'yjs-bytes');
        $disk->put('groups/team/.notes/Roadmap/team-note.md', $codec->serialize('Team', [], 'Group body ![img](https://example.com/a.png)'));

        DriveStarredItem::query()->create([
            'username' => 'bob',
            'path' => '/users/bob/.notes/Drafts/welcome.md',
            'created_at' => time(),
        ]);

        $exit = Artisan::call('wgw:notes:migrate-files');
        $this->assertSame(0, $exit);

        $welcome = $this->asBob()->getJson('/api/v1/notes/items')->assertStatus(400);
        unset($welcome);

        $notebooks = collect($this->asBob()->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'));
        $draftsId = (string) $notebooks->firstWhere('name', 'Drafts')['id'];
        $items = collect($this->asBob()->getJson('/api/v1/notes/items?notebookId='.$draftsId)->assertOk()->json('list'));
        $welcome = $items->firstWhere('title', 'Welcome');
        $this->assertIsArray($welcome);
        $this->assertSame('Hello body', $welcome['body']);
        $this->assertContains('focus', $welcome['categories']);
        $this->assertTrue($welcome['starred']);

        $archived = collect($this->asBob()->getJson('/api/v1/notes/items?notebookId='.$draftsId.'&status=CANCELLED')->assertOk()->json('list'));
        $this->assertNotNull($archived->firstWhere('title', 'Old'));

        $this->assertGreaterThan(0, NoteStar::query()->where('username', 'bob')->count());
        $this->assertFalse($disk->fileExists('users/bob/.notes/Drafts/.welcome.md.yjs'));

        $roadmap = $notebooks->first(
            fn (array $row): bool => ($row['name'] ?? '') === 'Roadmap' && ($row['groupSlug'] ?? null) === 'team',
        );
        $this->assertIsArray($roadmap, 'Group Roadmap notebook missing: '.json_encode($notebooks->all()));
        $groupId = (string) $roadmap['id'];
        $groupItems = collect($this->asBob()->getJson('/api/v1/notes/items?notebookId='.$groupId)->assertOk()->json('list'));
        $team = $groupItems->firstWhere('title', 'Team');
        $this->assertIsArray($team);
        $this->assertStringContainsString('![img]', (string) $team['body']);
    }

    private function asBob()
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
    }
}

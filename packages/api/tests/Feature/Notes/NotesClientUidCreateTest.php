<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\NoteRepository;
use Illuminate\Database\Events\QueryExecuted;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The app picks a note's UID when the note is made, so an offline create
 * needs no temporary id. The UID is also the collab room key: it must be a
 * UUID, unused by any other note, and a retry of the same create must land on
 * the same note instead of a second one.
 */
final class NotesClientUidCreateTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $provisioner = app(UserCalendarCollectionsProvisioner::class);
        $provisioner->ensureForPrincipal('principals/bob');
        $provisioner->ensureForPrincipal('principals/alice');
    }

    public function test_a_client_uuid_becomes_the_note_id(): void
    {
        $uid = (string) Str::uuid();

        $this->create('bob', $uid)->assertCreated()->assertJsonPath('id', $uid);
    }

    public function test_retrying_the_same_create_returns_the_existing_note(): void
    {
        $uid = (string) Str::uuid();
        $this->create('bob', $uid, 'First')->assertCreated();

        $this->create('bob', $uid, 'Retry')
            ->assertOk()
            ->assertJsonPath('id', $uid)
            ->assertJsonPath('title', 'First');

        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
    }

    public function test_a_uid_used_by_another_user_is_a_conflict(): void
    {
        $uid = (string) Str::uuid();
        $this->create('alice', $uid, 'Private')->assertCreated();

        $this->create('bob', $uid)->assertStatus(409)->assertJsonPath('code', 'alreadyExists');
        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
    }

    public function test_a_create_aimed_at_another_notebook_does_not_return_an_existing_note(): void
    {
        $uid = (string) Str::uuid();
        $this->create('bob', $uid, 'In General')->assertCreated();
        $other = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Elsewhere'])
            ->assertCreated()
            ->json('id');

        $this->create('bob', $uid, 'Elsewhere', $other)
            ->assertStatus(409)
            ->assertJsonPath('code', 'alreadyExists');
    }

    public function test_a_retry_naming_the_notebook_another_way_still_finds_the_note(): void
    {
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $this->addPrincipalToGroup($this->seedWgwGroup('principals/groups/eng', 'Engineering'), $bob);
        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal('principals/groups/eng', 'Engineering');
        $uid = (string) Str::uuid();
        $this->create('bob', $uid, 'First', CalendarCollectionUris::groupNotebookApiId('eng'))->assertCreated();

        // The same group notebook, named by its CalDAV uri instead of its API id.
        $this->create('bob', $uid, 'Retry', CalendarCollectionUris::groupNotebookCalDavUri('eng'))
            ->assertOk()
            ->assertJsonPath('id', $uid);
    }

    public function test_a_retry_after_much_later_still_returns_the_one_note(): void
    {
        // The tab closed before the first response arrived; the app sends the
        // same create again on its next load, however long that takes.
        $uid = (string) Str::uuid();
        $this->create('bob', $uid, 'First')->assertCreated();
        $this->travel(2)->days();

        foreach (['Retry', 'Second tab'] as $title) {
            $this->create('bob', $uid, $title)->assertOk()->assertJsonPath('id', $uid);
        }

        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
        $listed = collect($this->asUser('bob')
            ->getJson('/api/v1/notes/items?notebookId='.CalendarCollectionUris::NOTE_GENERAL)
            ->assertOk()
            ->json('list'))
            ->where('id', $uid);
        $this->assertCount(1, $listed);
        $this->assertSame('First', $listed->first()['title'] ?? null);
    }

    public function test_a_retry_that_loses_the_race_gets_the_note_the_winner_made(): void
    {
        // Two sends of one create: the other one commits after this request
        // checked for an existing note and before it inserts its own.
        $uid = (string) Str::uuid();
        $raced = false;
        // Deeper than this means the query runs inside the create's own transaction.
        $outside = DB::connection('wgw')->transactionLevel();
        DB::connection('wgw')->listen(function (QueryExecuted $query) use (&$raced, $uid, $outside): void {
            if ($raced || $query->connection->transactionLevel() > $outside) {
                return;
            }
            if (! str_contains($query->sql, 'calendarobjects') || ! in_array($uid, $query->bindings, true)) {
                return;
            }
            $raced = true;
            app(NoteRepository::class)->create('bob', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'uid' => $uid,
                'title' => 'Winner',
                'body' => '',
            ]);
        });

        $this->create('bob', $uid, 'Loser')
            ->assertOk()
            ->assertJsonPath('id', $uid)
            ->assertJsonPath('title', 'Winner');

        $this->assertTrue($raced, 'The race was never set up.');
        $this->assertSame(1, CalendarObject::query()->where('uid', $uid)->count());
    }

    public function test_a_uid_that_is_not_a_uuid_is_ignored_and_the_server_mints(): void
    {
        // A slash would make the room key read as a Drive path. An older app
        // still sends `local-*`; it must keep working, so the value is ignored.
        foreach (['../alice/secret-note', 'local-0123456789abcdef0123456789abcdef'] as $uid) {
            $id = (string) $this->create('bob', $uid)->assertCreated()->json('id');
            $this->assertNotSame($uid, $id);
            $this->assertTrue(Str::isUuid($id));
        }
    }

    public function test_without_a_uid_the_server_still_mints_one(): void
    {
        $id = (string) $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Minted',
        ])->assertCreated()->json('id');

        $this->assertTrue(Str::isUuid($id));
    }

    private function create(
        string $username,
        string $uid,
        string $title = 'Note',
        string $notebookId = CalendarCollectionUris::NOTE_GENERAL,
    ): TestResponse {
        return $this->asUser($username)->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'uid' => $uid,
            'title' => $title,
            'body' => '',
        ]);
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

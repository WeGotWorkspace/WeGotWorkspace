<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
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

    private function create(string $username, string $uid, string $title = 'Note'): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
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

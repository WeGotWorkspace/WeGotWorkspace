<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\NotebookNotesMover;
use Illuminate\Support\Facades\DB;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class NotebookDeleteWithMoveTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
    }

    public function test_delete_with_move_relocates_every_note_and_removes_the_notebook(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $starred = $this->createNote('bob', $source, 'Starred');
        $this->asUser('bob')->postJson('/api/v1/notes/items/'.$starred.'/star')->assertOk();
        $archived = $this->createNote('bob', $source, 'Archived');
        $this->archiveNote('bob', $archived);

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest)
            ->assertOk();

        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertNotFound();
        $moved = collect($this->noteList('bob', $dest))->keyBy('id');
        $this->assertTrue($moved->has($starred));
        $this->assertTrue($moved->has($archived));
        $this->assertTrue($moved[$starred]['starred']);
        $this->assertSame('CANCELLED', $moved[$archived]['status']);
    }

    public function test_delete_with_move_preserves_object_ids_stars_and_writes_dual_changelog(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $noteId = $this->createNote('bob', $source, 'Keep me', 'keep');
        $this->asUser('bob')->postJson('/api/v1/notes/items/'.$noteId.'/star')->assertOk();

        $object = CalendarObject::query()->where('uid', $noteId)->first();
        $this->assertNotNull($object);
        $objectId = (int) $object->id;
        $sourceCalendarId = (int) $object->calendarid;
        $starId = (int) NoteStar::query()->where('note_uid', $noteId)->value('id');
        $destCalendarId = (int) CalendarInstance::query()->where('uri', $dest)->value('calendarid');
        $destToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest)
            ->assertOk();

        $object->refresh();
        $this->assertSame($objectId, (int) $object->id);
        $this->assertSame($noteId, (string) $object->uid);
        $this->assertSame($destCalendarId, (int) $object->calendarid);
        $this->assertSame($starId, (int) NoteStar::query()->where('note_uid', $noteId)->value('id'));
        $this->assertSame($objectId, (int) NoteStar::query()->where('note_uid', $noteId)->value('calendar_object_id'));

        $destChanges = $this->asUser('bob')
            ->getJson('/api/v1/notes/items/changes?notebookId='.$dest)
            ->assertOk()
            ->json();
        $this->assertContains($noteId, $destChanges['created']);

        $newDestToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');
        $this->assertGreaterThan($destToken, $newDestToken);
        $this->assertNotNull(
            DB::connection('wgw')->table('calendarchanges')
                ->where('calendarid', $destCalendarId)
                ->where('uri', (string) $object->uri)
                ->where('operation', 1)
                ->first(),
        );
        // Sabre deleteCalendar removes the source calendar and its changelog, so the
        // source changes feed 404s after this request. The object row surviving on
        // the destination is the proof the move happened before that delete.
        $this->assertNull(DB::connection('wgw')->table('calendars')->where('id', $sourceCalendarId)->first());
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertNotFound();
    }

    public function test_delete_with_move_includes_archived_notes(): void
    {
        $source = $this->createNotebook('bob', 'Archive Only');
        $dest = $this->createNotebook('bob', 'Dest');
        $archived = $this->createNote('bob', $source, 'Only archived');
        $this->archiveNote('bob', $archived);

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest)
            ->assertOk();

        $moved = collect($this->noteList('bob', $dest))->firstWhere('id', $archived);
        $this->assertIsArray($moved);
        $this->assertSame('CANCELLED', $moved['status']);
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertNotFound();
    }

    public function test_delete_with_move_to_a_read_only_destination_is_forbidden_and_moves_nothing(): void
    {
        $dest = $this->createNotebook('alice', 'Read Only');
        $this->asUser('alice')->patchJson('/api/v1/notes/notebooks/'.$dest, [
            'shareWith' => ['bob' => ['mayReadItems' => true]],
        ])->assertOk();
        $sharedId = $this->notebookIdByName('bob', 'Read Only');

        $source = $this->createNotebook('bob', 'Source');
        $noteId = $this->createNote('bob', $source, 'Stay');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$sharedId)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $this->assertContains($noteId, array_column($this->noteList('bob', $source), 'id'));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertOk();
        $this->assertNotContains($noteId, array_column($this->noteList('alice', $dest), 'id'));
    }

    public function test_delete_with_move_to_an_unknown_destination_is_not_found_and_moves_nothing(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $noteId = $this->createNote('bob', $source, 'Stay');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo=missing-notebook')
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');

        $this->assertContains($noteId, array_column($this->noteList('bob', $source), 'id'));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertOk();
    }

    public function test_delete_with_move_to_itself_is_rejected(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $noteId = $this->createNote('bob', $source, 'Stay');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$source)
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->assertContains($noteId, array_column($this->noteList('bob', $source), 'id'));
    }

    public function test_move_notes_to_combined_with_on_destroy_remove_contents_is_rejected(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $noteId = $this->createNote('bob', $source, 'Stay');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest.'&onDestroyRemoveContents=1')
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source, [
                'moveNotesTo' => $dest,
                'onDestroyRemoveContents' => true,
            ])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->assertContains($noteId, array_column($this->noteList('bob', $source), 'id'));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertOk();
    }

    public function test_delete_with_move_is_rejected_for_the_general_notebook(): void
    {
        $dest = $this->createNotebook('bob', 'Dest');
        $noteId = $this->createNote('bob', CalendarCollectionUris::NOTE_GENERAL, 'Stay');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.CalendarCollectionUris::NOTE_GENERAL.'?moveNotesTo='.$dest)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $this->assertContains($noteId, array_column($this->noteList('bob', CalendarCollectionUris::NOTE_GENERAL), 'id'));
        $this->assertNotContains($noteId, array_column($this->noteList('bob', $dest), 'id'));
    }

    public function test_delete_with_move_is_rejected_for_a_provisioned_group_notebook(): void
    {
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $crew = $this->seedWgwGroup('principals/groups/crew', 'Crew');
        $this->addPrincipalToGroup($crew, $bob);
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks')->assertOk();

        $dest = $this->createNotebook('bob', 'Dest');
        $groupId = CalendarCollectionUris::groupNotebookApiId('crew');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$groupId.'?moveNotesTo='.$dest)
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');

        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$groupId)->assertOk();
    }

    public function test_delete_with_move_dismisses_an_inbound_share_without_moving_anything(): void
    {
        $source = $this->createNotebook('bob', 'Shared Notes');
        $noteId = $this->createNote('bob', $source, 'Owner note');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$source, [
            'shareWith' => ['alice' => ['mayWriteAll' => true]],
        ])->assertOk();
        $sharedId = $this->notebookIdByName('alice', 'Shared Notes');
        $dest = $this->createNotebook('alice', 'Alice Dest');

        $this->asUser('alice')
            ->deleteJson('/api/v1/notes/notebooks/'.$sharedId.'?moveNotesTo='.$dest)
            ->assertOk();

        $this->assertNull($this->notebookRowOrNull('alice', 'Shared Notes'));
        $this->assertContains($noteId, array_column($this->noteList('bob', $source), 'id'));
        $this->assertNotContains($noteId, array_column($this->noteList('alice', $dest), 'id'));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertOk();
    }

    public function test_delete_with_move_bumps_the_destination_synctoken_once_for_many_notes(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $this->createNote('bob', $source, 'One');
        $this->createNote('bob', $source, 'Two');
        $destCalendarId = (int) CalendarInstance::query()->where('uri', $dest)->value('calendarid');
        $destToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest)
            ->assertOk();

        $newDestToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');
        $this->assertSame($destToken + 1, $newDestToken);
        $this->assertSame(
            2,
            DB::connection('wgw')->table('calendarchanges')
                ->where('calendarid', $destCalendarId)
                ->where('operation', 1)
                ->count(),
        );
    }

    public function test_bulk_move_writes_only_the_destination_add_and_bumps_only_that_token(): void
    {
        $source = $this->createNotebook('bob', 'Source Only');
        $dest = $this->createNotebook('bob', 'Dest Only');
        $this->createNote('bob', $source, 'One');
        $this->createNote('bob', $source, 'Two');
        $sourceInstance = CalendarInstance::query()->where('uri', $source)->first();
        $destInstance = CalendarInstance::query()->where('uri', $dest)->first();
        $this->assertNotNull($sourceInstance);
        $this->assertNotNull($destInstance);
        $sourceCalendarId = (int) $sourceInstance->calendarid;
        $destCalendarId = (int) $destInstance->calendarid;
        $sourceToken = (int) DB::connection('wgw')->table('calendars')->where('id', $sourceCalendarId)->value('synctoken');
        $destToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');

        app(NotebookNotesMover::class)->moveAll($sourceInstance, $destInstance);

        $this->assertSame($sourceToken, (int) DB::connection('wgw')->table('calendars')->where('id', $sourceCalendarId)->value('synctoken'));
        $this->assertSame(0, DB::connection('wgw')->table('calendarchanges')->where('calendarid', $sourceCalendarId)->where('operation', 3)->count());
        $this->assertSame($destToken + 1, (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken'));
        $this->assertSame(2, DB::connection('wgw')->table('calendarchanges')->where('calendarid', $destCalendarId)->where('operation', 1)->count());
    }

    public function test_delete_with_move_aborts_when_destination_uid_collides(): void
    {
        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $sourceNote = $this->createNote('bob', $source, 'Source note');
        $destNote = $this->createNote('bob', $dest, 'Dest note');
        CalendarObject::query()->where('uid', $destNote)->update(['uid' => $sourceNote]);

        $this->asUser('bob')
            ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest)
            ->assertStatus(409)
            ->assertJsonPath('code', 'alreadyExists');

        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$source)->assertOk();
        $this->assertContains($sourceNote, array_column($this->noteList('bob', $source), 'id'));
        $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$dest)->assertOk();
    }

    public function test_delete_with_move_rolls_back_when_removing_the_notebook_fails(): void
    {
        if (DB::connection('wgw')->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('Notebook removal failure is forced with a SQLite trigger.');
        }

        $source = $this->createNotebook('bob', 'Source');
        $dest = $this->createNotebook('bob', 'Dest');
        $noteId = $this->createNote('bob', $source, 'Stay');
        $sourceCalendarId = (int) CalendarInstance::query()->where('uri', $source)->value('calendarid');

        DB::connection('wgw')->unprepared('DROP TRIGGER IF EXISTS abort_calendar_delete');
        DB::connection('wgw')->unprepared(
            "CREATE TRIGGER abort_calendar_delete BEFORE DELETE ON calendars BEGIN SELECT RAISE(FAIL, 'calendar delete failed'); END",
        );

        try {
            $response = $this->asUser('bob')
                ->deleteJson('/api/v1/notes/notebooks/'.$source.'?moveNotesTo='.$dest);

            $object = CalendarObject::query()->where('uid', $noteId)->first();
            $this->assertNotNull($object);
            $this->assertSame($sourceCalendarId, (int) $object->calendarid);
            $this->assertNotNull(CalendarInstance::query()->where('uri', $source)->first());
            $this->assertGreaterThanOrEqual(500, $response->status());
        } finally {
            DB::connection('wgw')->unprepared('DROP TRIGGER IF EXISTS abort_calendar_delete');
        }
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }

    private function createNotebook(string $username, string $name): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/notes/notebooks', ['name' => $name])
            ->assertCreated()
            ->json('id');
    }

    private function createNote(string $username, string $notebookId, string $title, string $body = 'x'): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/notes/items', [
                'notebookId' => $notebookId,
                'title' => $title,
                'body' => $body,
            ])
            ->assertCreated()
            ->json('id');
    }

    private function archiveNote(string $username, string $noteId): void
    {
        $etag = (string) $this->asUser($username)->getJson('/api/v1/notes/items/'.$noteId)->headers->get('ETag');
        $this->asUser($username)->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$noteId, ['status' => 'CANCELLED'])
            ->assertOk()
            ->assertJsonPath('status', 'CANCELLED');
    }

    /** @return list<array<string, mixed>> */
    private function noteList(string $username, string $notebookId): array
    {
        $list = $this->asUser($username)
            ->getJson('/api/v1/notes/items?notebookId='.$notebookId)
            ->assertOk()
            ->json('list');

        return is_array($list) ? $list : [];
    }

    private function notebookIdByName(string $username, string $name): string
    {
        $row = $this->notebookRowOrNull($username, $name);
        $this->assertIsArray($row);

        return (string) $row['id'];
    }

    /** @return array<string, mixed>|null */
    private function notebookRowOrNull(string $username, string $name): ?array
    {
        $list = $this->asUser($username)->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        foreach ($list as $row) {
            if (is_array($row) && ($row['name'] ?? '') === $name) {
                return $row;
            }
        }

        return null;
    }
}

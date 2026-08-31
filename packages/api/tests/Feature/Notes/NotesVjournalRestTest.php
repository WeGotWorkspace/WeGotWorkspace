<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Ramsey\Uuid\Uuid;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class NotesVjournalRestTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    public function test_lists_notebooks_including_general(): void
    {
        $list = $this->asBob()->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        $ids = array_column($list, 'id');
        $this->assertContains(CalendarCollectionUris::NOTE_GENERAL, $ids);
        $general = collect($list)->firstWhere('id', CalendarCollectionUris::NOTE_GENERAL);
        $this->assertTrue($general['isDefault']);
        $this->assertSame('General', $general['name']);
    }

    public function test_create_notebook_named_starred_does_not_use_reserved_uri(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/notebooks', ['name' => 'Starred'])
            ->assertCreated()
            ->json();
        $this->assertSame('Starred', $created['name']);
        $this->assertNotSame('starred', $created['id']);
        $this->assertNotContains($created['id'], CalendarCollectionUris::reservedNoteUriSlugs());

        $renamed = $this->asBob()->patchJson('/api/v1/notes/notebooks/'.$created['id'], [
            'name' => 'Archive',
        ])->assertOk()->json();
        $this->assertSame($created['id'], $renamed['id']);
        $this->assertSame('Archive', $renamed['name']);

        $this->asBob()->postJson('/api/v1/notes/notebooks', ['id' => 'starred', 'name' => 'Also Starred'])
            ->assertStatus(409)
            ->assertJsonPath('code', 'alreadyExists');
    }

    public function test_create_notebook_persists_color(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/notebooks', [
            'name' => 'Pink',
            'color' => '#ec4899',
        ])->assertCreated();
        $created->assertJsonPath('name', 'Pink')->assertJsonPath('color', '#ec4899');

        $list = $this->asBob()->getJson('/api/v1/notes/notebooks')->assertOk()->json('list');
        $row = collect($list)->firstWhere('name', 'Pink');
        $this->assertIsArray($row);
        $this->assertSame('#ec4899', $row['color']);
    }

    public function test_create_and_get_note_by_uid_when_uri_differs(): void
    {
        $uid = 'foreign-uid-'.bin2hex(random_bytes(4));
        $this->seedJournalViaPdo('odd-href.ics', $this->journalIcs($uid, 'Foreign href', 'Body'), $uid);

        $note = $this->asBob()->getJson('/api/v1/notes/items/'.$uid)->assertOk();
        $note->assertJsonPath('id', $uid)
            ->assertJsonPath('title', 'Foreign href')
            ->assertJsonPath('body', 'Body')
            ->assertJsonPath('notebookId', CalendarCollectionUris::NOTE_GENERAL)
            ->assertJsonPath('updatedAt', '2026-08-28T12:00:00Z');

        $row = CalendarObject::query()->where('uid', $uid)->first();
        $this->assertNotNull($row);
        $this->assertSame('odd-href.ics', (string) $row->uri);
        $this->assertNotSame($uid.'.ics', (string) $row->uri);
    }

    public function test_client_supplied_uid_is_ignored(): void
    {
        $hostile = '../alice/secret-note';
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Mine',
            'body' => 'one',
            'uid' => $hostile,
        ])->assertCreated();
        $id = (string) $created->json('id');
        $this->assertNotSame($hostile, $id);
        $this->assertMatchesRegularExpression(
            '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i',
            $id,
        );
    }

    public function test_duplicate_uid_is_conflict_not_server_error(): void
    {
        $uid = (string) Str::uuid();
        $this->seedJournalViaPdo($uid.'.ics', $this->journalIcs($uid, 'First', 'one'), $uid);

        Str::createUuidsUsing(static fn () => Uuid::fromString($uid));
        try {
            $this->asBob()->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Second',
                'body' => 'two',
            ])->assertStatus(409)->assertJsonPath('code', 'alreadyExists');
        } finally {
            Str::createUuidsNormally();
        }
    }

    public function test_patch_requires_if_match_and_rejects_stale_etag(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Title',
            'body' => 'hello',
        ])->assertCreated();
        $id = (string) $created->json('id');
        $etag = (string) ($created->headers->get('ETag') ?? $created->json('etag'));

        $this->asBob()->patchJson('/api/v1/notes/items/'.$id, ['title' => 'No header'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');

        $this->asBob()->withHeaders(['If-Match' => '"stale-etag"'])
            ->patchJson('/api/v1/notes/items/'.$id, ['title' => 'Stale'])
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');

        $this->asBob()->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$id, ['title' => 'Updated'])
            ->assertOk()
            ->assertJsonPath('title', 'Updated')
            ->assertJsonPath('body', 'hello');
    }

    public function test_delete_succeeds_without_if_match_and_honors_it_when_sent(): void
    {
        $first = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Drop me',
            'body' => 'gone',
        ])->assertCreated();
        $firstId = (string) $first->json('id');

        $this->asBob()->deleteJson('/api/v1/notes/items/'.$firstId)->assertOk();
        $this->asBob()->getJson('/api/v1/notes/items/'.$firstId)->assertNotFound();

        $second = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Guard me',
            'body' => 'stay',
        ])->assertCreated();
        $secondId = (string) $second->json('id');
        $etag = (string) ($second->headers->get('ETag') ?? $second->json('etag'));

        $this->asBob()->withHeaders(['If-Match' => '"stale-etag"'])
            ->deleteJson('/api/v1/notes/items/'.$secondId)
            ->assertStatus(412)
            ->assertJsonPath('code', 'precondition_failed');

        $this->asBob()->withHeaders(['If-Match' => $etag])
            ->deleteJson('/api/v1/notes/items/'.$secondId)
            ->assertOk();
        $this->asBob()->getJson('/api/v1/notes/items/'.$secondId)->assertNotFound();
    }

    public function test_oversize_body_is_413(): void
    {
        $body = str_repeat('x', NoteJournalConverter::MAX_MARKDOWN_BYTES + 1);
        $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Huge',
            'body' => $body,
        ])->assertStatus(413);
    }

    public function test_star_cascades_on_item_and_notebook_delete(): void
    {
        $notebook = $this->asBob()->postJson('/api/v1/notes/notebooks', ['name' => 'Scratch'])
            ->assertCreated()
            ->json();
        $notebookId = (string) $notebook['id'];

        $note = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Star me',
            'body' => 'x',
        ])->assertCreated();
        $noteId = (string) $note['id'];

        $this->asBob()->postJson('/api/v1/notes/items/'.$noteId.'/star')->assertOk();
        $this->assertSame(1, NoteStar::query()->where('note_uid', $noteId)->count());

        $etag = (string) ($note->headers->get('ETag') ?? $note->json('etag'));
        $this->asBob()->withHeaders(['If-Match' => $etag])
            ->deleteJson('/api/v1/notes/items/'.$noteId)
            ->assertOk();
        $this->assertSame(0, NoteStar::query()->where('note_uid', $noteId)->count());

        $second = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Also starred',
            'body' => 'y',
        ])->assertCreated();
        $secondId = (string) $second->json('id');
        $this->asBob()->postJson('/api/v1/notes/items/'.$secondId.'/star')->assertOk();
        $this->assertSame(1, NoteStar::query()->where('note_uid', $secondId)->count());

        $this->asBob()->deleteJson(
            '/api/v1/notes/notebooks/'.$notebookId.'?onDestroyRemoveContents=1',
        )->assertOk();
        $this->assertSame(0, NoteStar::query()->where('note_uid', $secondId)->count());
    }

    public function test_delete_nonempty_notebook_requires_on_destroy_query_or_body(): void
    {
        $notebookId = (string) $this->asBob()->postJson('/api/v1/notes/notebooks', ['name' => 'Filled'])
            ->assertCreated()
            ->json('id');
        $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Keep',
            'body' => 'x',
        ])->assertCreated();

        $this->asBob()->deleteJson('/api/v1/notes/notebooks/'.$notebookId)
            ->assertStatus(409)
            ->assertJsonPath('code', 'notebookHasContents');

        $this->asBob()->deleteJson(
            '/api/v1/notes/notebooks/'.$notebookId.'?onDestroyRemoveContents=1',
        )->assertOk();

        $this->asBob()->getJson('/api/v1/notes/notebooks/'.$notebookId)->assertNotFound();
    }

    public function test_move_keeps_object_id_and_star_and_writes_dual_changelog(): void
    {
        $dest = $this->asBob()->postJson('/api/v1/notes/notebooks', ['name' => 'Dest'])
            ->assertCreated()
            ->json('id');

        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Move me',
            'body' => 'keep',
        ])->assertCreated();
        $noteId = (string) $created->json('id');
        $this->asBob()->postJson('/api/v1/notes/items/'.$noteId.'/star')->assertOk();

        $object = CalendarObject::query()->where('uid', $noteId)->first();
        $this->assertNotNull($object);
        $objectId = (int) $object->id;
        $starId = (int) NoteStar::query()->where('note_uid', $noteId)->value('id');
        $sourceCalendarId = (int) $object->calendarid;
        $sourceToken = (int) DB::connection('wgw')->table('calendars')->where('id', $sourceCalendarId)->value('synctoken');

        $etag = (string) ($created->headers->get('ETag') ?? $created->json('etag'));
        $sourceSince = (string) $sourceToken;

        $moved = $this->asBob()->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$noteId, ['notebookId' => $dest])
            ->assertOk();
        $moved->assertJsonPath('notebookId', $dest);
        $moved->assertJsonPath('body', 'keep');

        $object->refresh();
        $this->assertSame($objectId, (int) $object->id);
        $this->assertSame($noteId, (string) $object->uid);
        $this->assertSame($starId, (int) NoteStar::query()->where('note_uid', $noteId)->value('id'));
        $this->assertSame($objectId, (int) NoteStar::query()->where('note_uid', $noteId)->value('calendar_object_id'));
        $this->assertNotSame($sourceCalendarId, (int) $object->calendarid);

        $sourceChanges = $this->asBob()
            ->getJson('/api/v1/notes/items/changes?notebookId='.CalendarCollectionUris::NOTE_GENERAL.'&since='.$sourceSince)
            ->assertOk()
            ->json();
        $this->assertContains($noteId, $sourceChanges['destroyed']);

        $destChanges = $this->asBob()
            ->getJson('/api/v1/notes/items/changes?notebookId='.$dest)
            ->assertOk()
            ->json();
        $this->assertContains($noteId, $destChanges['created']);

        $newSourceToken = (int) DB::connection('wgw')->table('calendars')->where('id', $sourceCalendarId)->value('synctoken');
        $destCalendarId = (int) $object->calendarid;
        $newDestToken = (int) DB::connection('wgw')->table('calendars')->where('id', $destCalendarId)->value('synctoken');
        $this->assertGreaterThan($sourceToken, $newSourceToken);
        $this->assertGreaterThan(1, $newDestToken);
    }

    public function test_empty_description_create_and_patch_persist(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => null,
            'body' => '',
        ])->assertCreated();
        $id = (string) $created->json('id');
        $created->assertJsonPath('id', $id)
            ->assertJsonPath('title', null)
            ->assertJsonPath('body', '');

        $list = $this->asBob()->getJson(
            '/api/v1/notes/items?notebookId='.CalendarCollectionUris::NOTE_GENERAL
        )->assertOk()->json('list');
        $ids = array_column($list, 'id');
        $this->assertContains($id, $ids);

        $etag = (string) ($created->headers->get('ETag') ?? $created->json('etag'));
        $this->asBob()->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$id, ['title' => 'Title only', 'body' => ''])
            ->assertOk()
            ->assertJsonPath('title', 'Title only')
            ->assertJsonPath('body', '');

        $this->asBob()->getJson('/api/v1/notes/items/'.$id)
            ->assertOk()
            ->assertJsonPath('title', 'Title only')
            ->assertJsonPath('body', '');
    }

    public function test_archive_status_cancelled_and_title_patch_does_not_clobber_body(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Keep body',
            'body' => 'important',
        ])->assertCreated();
        $id = (string) $created->json('id');
        $etag = (string) ($created->headers->get('ETag') ?? $created->json('etag'));

        $this->asBob()->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$id, ['status' => 'CANCELLED', 'title' => 'Archived'])
            ->assertOk()
            ->assertJsonPath('status', 'CANCELLED')
            ->assertJsonPath('title', 'Archived')
            ->assertJsonPath('body', 'important');
    }

    public function test_list_notes_survives_missing_jmap_note_states_table(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Keep listing',
            'body' => 'even without jmap state',
        ])->assertCreated();
        $id = (string) $created->json('id');

        Schema::connection('wgw')->dropIfExists('jmap_note_states');
        try {
            $list = $this->asBob()
                ->getJson('/api/v1/notes/items?notebookId='.CalendarCollectionUris::NOTE_GENERAL)
                ->assertOk()
                ->json('list');
            $this->assertContains($id, array_column($list, 'id'));
        } finally {
            $this->restoreJmapNoteStatesTable();
        }
    }

    public function test_create_note_survives_missing_jmap_note_states_table(): void
    {
        Schema::connection('wgw')->dropIfExists('jmap_note_states');
        try {
            $created = $this->asBob()->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Created without state table',
                'body' => 'ok',
            ])->assertCreated();
            $this->assertNotSame('', (string) $created->json('id'));
        } finally {
            $this->restoreJmapNoteStatesTable();
        }
    }

    public function test_list_notes_survives_missing_note_stars_table(): void
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Keep listing',
            'body' => 'even without stars',
        ])->assertCreated();
        $id = (string) $created->json('id');

        Schema::connection('wgw')->dropIfExists('note_stars');
        try {
            $list = $this->asBob()
                ->getJson('/api/v1/notes/items?notebookId='.CalendarCollectionUris::NOTE_GENERAL)
                ->assertOk()
                ->json('list');
            $this->assertContains($id, array_column($list, 'id'));
        } finally {
            $this->restoreNoteStarsTable();
        }
    }

    private function asBob()
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
    }

    private function restoreJmapNoteStatesTable(): void
    {
        $migration = require database_path('migrations/wgw/2026_08_31_000320_wgw_create_jmap_note_states.php');
        $migration->up();
    }

    private function restoreNoteStarsTable(): void
    {
        $migration = require database_path('migrations/wgw/2026_08_28_000310_wgw_notes_uid_unique_and_stars.php');
        $migration->up();
    }

    private function seedJournalViaPdo(string $uri, string $ics, string $uid): void
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $row = DB::connection('wgw')->table('calendarinstances')
            ->where('principaluri', 'principals/bob')
            ->where('uri', CalendarCollectionUris::NOTE_GENERAL)
            ->first();
        $this->assertNotNull($row);
        $caldav->createCalendarObject([(int) $row->calendarid, (int) $row->id], $uri, $ics);
        CalendarObject::query()->where('calendarid', (int) $row->calendarid)->where('uri', $uri)->update(['uid' => $uid]);
    }

    private function journalIcs(string $uid, string $title, string $body): string
    {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//WGW//Notes//EN\r\nBEGIN:VJOURNAL\r\nUID:{$uid}\r\nDTSTAMP:20260828T120000Z\r\nSUMMARY:{$title}\r\nDESCRIPTION:{$body}\r\nEND:VJOURNAL\r\nEND:VCALENDAR\r\n";
    }
}

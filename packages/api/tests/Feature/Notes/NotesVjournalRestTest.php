<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarObject;
use App\Models\NoteStar;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Support\Facades\DB;
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

    public function test_create_and_get_note_by_uid_when_uri_differs(): void
    {
        $uid = 'foreign-uid-'.bin2hex(random_bytes(4));
        $this->seedJournalViaPdo('odd-href.ics', $this->journalIcs($uid, 'Foreign href', 'Body'), $uid);

        $note = $this->asBob()->getJson('/api/v1/notes/items/'.$uid)->assertOk();
        $note->assertJsonPath('id', $uid)
            ->assertJsonPath('title', 'Foreign href')
            ->assertJsonPath('body', 'Body')
            ->assertJsonPath('notebookId', CalendarCollectionUris::NOTE_GENERAL);

        $row = CalendarObject::query()->where('uid', $uid)->first();
        $this->assertNotNull($row);
        $this->assertSame('odd-href.ics', (string) $row->uri);
        $this->assertNotSame($uid.'.ics', (string) $row->uri);
    }

    public function test_duplicate_uid_in_same_notebook_is_conflict(): void
    {
        $uid = 'dup-uid-'.bin2hex(random_bytes(4));
        $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'First',
            'body' => 'one',
            'uid' => $uid,
        ])->assertCreated();

        $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Second',
            'body' => 'two',
            'uid' => $uid,
        ])->assertStatus(409)->assertJsonPath('code', 'alreadyExists');
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

        $this->asBob()->deleteJson('/api/v1/notes/notebooks/'.$notebookId, [
            'onDestroyRemoveContents' => true,
        ])->assertOk();
        $this->assertSame(0, NoteStar::query()->where('note_uid', $secondId)->count());
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

    private function asBob()
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
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

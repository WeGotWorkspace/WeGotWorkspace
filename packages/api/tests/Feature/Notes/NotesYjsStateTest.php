<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Auth\JwtTokenService;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Collab\YjsBytes;
use App\Services\Notes\Conversion\NoteJournalConverter;
use App\Services\Notes\NoteYjsProjection;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\OptimisticConcurrencyTestHelpers;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

final class NotesYjsStateTest extends WgwDatabaseTestCase
{
    use OptimisticConcurrencyTestHelpers;
    use SeedsWgwIdentity;
    use SendsFramedCollaboration;

    /** @var list<int> */
    private const YJS = [0, 1, 2, 255];

    private const BINARY = "\x00\x01\x02\xff";

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

    public function test_patch_stores_yjs_and_get_returns_the_same_bytes(): void
    {
        $note = $this->createNote();

        $patched = $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $this->assertArrayNotHasKey('yjs', $patched->json());

        $state = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk();
        $this->assertSame(self::BINARY, $state->getContent());

        $json = $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->assertOk()->json();
        $this->assertArrayNotHasKey('yjs', $json);

        $queries = [];
        DB::listen(function (object $query) use (&$queries): void {
            $queries[] = $query->sql;
        });
        $list = $this->asUser('bob')
            ->getJson('/api/v1/notes/items?notebookId='.CalendarCollectionUris::NOTE_GENERAL)
            ->assertOk()
            ->json('list');
        foreach ($list as $row) {
            $this->assertArrayNotHasKey('yjs', $row);
        }
        foreach ($queries as $sql) {
            $this->assertStringNotContainsString('note_yjs_state', $sql);
        }
    }

    public function test_patch_without_yjs_leaves_the_row_unchanged(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $before = $this->storedState($note['id']);

        $current = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');
        $this->patchNote($note['id'], $current, ['title' => 'Renamed'])->assertOk();

        $after = $this->storedState($note['id']);
        $this->assertSame($before['bytes'], $after['bytes']);
        $this->assertSame($before['object_etag'], $after['object_etag']);
    }

    public function test_category_validation_does_not_load_yjs_state(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], [
            'yjs' => self::YJS,
            'categories' => ['focus'],
        ])->assertOk();

        $queries = [];
        DB::listen(function (object $query) use (&$queries): void {
            $queries[] = $query->sql;
        });
        $etag = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');
        $queries = [];
        $this->patchNote($note['id'], $etag, ['categories' => ['focus', 'v2']])
            ->assertStatus(400);

        foreach ($queries as $sql) {
            $this->assertStringNotContainsString('note_yjs_state', $sql);
        }
        $this->assertSame(self::BINARY, $this->storedState($note['id'])['bytes']);
    }

    public function test_format_yjs_without_a_row_is_204_without_etag(): void
    {
        $note = $this->createNote();

        $response = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNoContent();
        $this->assertFalse($response->headers->has('ETag'));
    }

    public function test_format_yjs_returns_raw_bytes_etag_and_304(): void
    {
        $note = $this->createNote();
        $patched = $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $noteEtag = (string) $patched->headers->get('ETag');

        $state = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk();
        $stateEtag = '"'.sha1(self::BINARY).'"';
        $this->assertSame(self::BINARY, $state->getContent());
        $this->assertSame($stateEtag, (string) $state->headers->get('ETag'));
        $this->assertNotSame($noteEtag, $stateEtag);
        $this->assertSame(
            $noteEtag,
            (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag'),
        );

        $this->asUser('bob')
            ->withHeaders(['If-None-Match' => $noteEtag])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertHeader('ETag', $stateEtag);

        $this->asUser('bob')
            ->withHeaders(['If-None-Match' => $stateEtag])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertStatus(304)
            ->assertHeader('ETag', $stateEtag);

        $this->asUser('bob')
            ->withHeaders(['If-None-Match' => '*'])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertStatus(304);

        $this->asUser('bob')
            ->withHeaders(['If-None-Match' => '"stale-etag"'])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertContent(self::BINARY);
    }

    public function test_yjs_write_failure_rolls_back_description_and_etag(): void
    {
        $note = $this->createNote(body: 'original');
        $stored = CalendarObject::query()->where('uid', $note['id'])->first();
        $this->assertNotNull($stored);
        $calendarData = (string) $stored->calendardata;
        $storedEtag = (string) $stored->etag;

        $armed = true;
        DB::connection('wgw')->beforeExecuting(function (string $sql) use (&$armed): void {
            if ($armed && str_contains($sql, 'note_yjs_state')) {
                $armed = false;
                throw new \RuntimeException('forced yjs failure');
            }
        });

        $this->patchNote($note['id'], $note['etag'], [
            'title' => 'Changed',
            'body' => 'rewritten',
            'yjs' => self::YJS,
        ])->assertStatus(500);

        $armed = false;
        $stored->refresh();
        $this->assertSame($calendarData, (string) $stored->calendardata);
        $this->assertSame($storedEtag, (string) $stored->etag);
        $this->assertStringContainsString('original', (string) $stored->calendardata);
        $this->assertStringNotContainsString('rewritten', (string) $stored->calendardata);
        $this->assertNull(NoteYjsState::query()->where('calendar_object_id', $stored->id)->first());

        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('title', 'Title')
            ->assertJsonPath('body', 'original')
            ->assertHeader('ETag', $note['etag']);
    }

    /**
     * object_etag stays the journal ETag. The collaborative PUT's response
     * ETag is the state tag and is covered separately.
     */
    public function test_object_etag_matches_the_response_etag(): void
    {
        $note = $this->createNote();
        $patched = $this->patchNote($note['id'], $note['etag'], [
            'title' => 'With state',
            'yjs' => self::YJS,
        ])->assertOk();

        $responseEtag = (string) $patched->headers->get('ETag');
        $this->assertNotSame($note['etag'], $responseEtag);
        $this->assertSame($responseEtag, $this->storedState($note['id'])['object_etag']);
    }

    public function test_move_keeps_the_yjs_row(): void
    {
        $note = $this->createNote();
        $patched = $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $objectId = (int) CalendarObject::query()->where('uid', $note['id'])->value('id');

        $dest = (string) $this->asUser('bob')->postJson('/api/v1/notes/notebooks', ['name' => 'Elsewhere'])
            ->assertCreated()
            ->json('id');
        $this->patchNote($note['id'], (string) $patched->headers->get('ETag'), [
            'notebookId' => $dest,
        ])->assertOk()->assertJsonPath('notebookId', $dest);

        $row = NoteYjsState::query()->where('calendar_object_id', $objectId)->first();
        $this->assertNotNull($row);
        $this->assertSame($objectId, (int) $row->calendar_object_id);
        $this->assertSame(self::BINARY, $this->binaryOf($row));
        $this->assertSame(self::BINARY, $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->getContent());
    }

    public function test_delete_removes_the_yjs_row(): void
    {
        $note = $this->createNote();
        $patched = $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $objectId = (int) CalendarObject::query()->where('uid', $note['id'])->value('id');
        $this->assertSame(1, NoteYjsState::query()->where('calendar_object_id', $objectId)->count());

        $this->asUser('bob')
            ->withHeaders(['If-Match' => (string) $patched->headers->get('ETag')])
            ->deleteJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk();

        $this->assertSame(0, NoteYjsState::query()->where('calendar_object_id', $objectId)->count());
        $this->assertSame(0, NoteYjsState::query()->where('note_uid', $note['id'])->count());
    }

    public function test_oversized_yjs_is_413_and_leaves_the_row(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $before = $this->storedState($note['id']);
        $stored = CalendarObject::query()->where('uid', $note['id'])->first();
        $this->assertNotNull($stored);
        $calendarData = (string) $stored->calendardata;
        $storedEtag = (string) $stored->etag;

        $body = '{"yjs":['.str_repeat('1,', YjsBytes::MAX_BYTES).'1]}';
        $etag = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');
        $response = $this->asUser('bob')->call(
            'PATCH',
            '/api/v1/notes/items/'.$note['id'],
            [],
            [],
            [],
            $this->transformHeadersToServerVars([
                'Content-Type' => 'application/json',
                'Accept' => 'application/json',
                'If-Match' => $etag,
            ]),
            $body,
        );
        unset($body);

        $response->assertStatus(413)->assertJsonPath('code', 'payload_too_large');
        $stored->refresh();
        $this->assertSame($calendarData, (string) $stored->calendardata);
        $this->assertSame($storedEtag, (string) $stored->etag);
        $after = $this->storedState($note['id']);
        $this->assertSame($before['bytes'], $after['bytes']);
        $this->assertSame($before['object_etag'], $after['object_etag']);
    }

    public function test_invalid_yjs_is_rejected_and_leaves_the_row(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();
        $before = $this->storedState($note['id']);
        $etag = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');

        $this->patchNote($note['id'], $etag, ['yjs' => [1, 256, -1]])->assertStatus(400);

        $after = $this->storedState($note['id']);
        $this->assertSame($before['bytes'], $after['bytes']);
        $this->assertSame($before['object_etag'], $after['object_etag']);
    }

    public function test_another_user_cannot_read_or_write_yjs_state(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();

        $this->asUser('alice')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNotFound();
        $this->asUser('alice')
            ->withHeaders(['If-Match' => $note['etag']])
            ->patchJson('/api/v1/notes/items/'.$note['id'], ['yjs' => [9]])
            ->assertNotFound();
        $this->assertSame(self::BINARY, $this->storedState($note['id'])['bytes']);
    }

    public function test_read_only_share_can_read_yjs_but_cannot_write_it(): void
    {
        $notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Read Only'])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
            'shareWith' => ['alice' => ['mayReadItems' => true]],
        ])->assertOk();

        $created = $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Shared',
            'body' => 'secret',
        ])->assertCreated();
        $id = (string) $created->json('id');
        $etag = (string) $created->headers->get('ETag');
        $this->patchNote($id, $etag, ['yjs' => self::YJS])->assertOk();

        $this->asUser('alice')
            ->get('/api/v1/notes/items/'.$id.'?format=yjs')
            ->assertOk()
            ->assertContent(self::BINARY);

        $sharedEtag = (string) $this->asUser('alice')->getJson('/api/v1/notes/items/'.$id)->headers->get('ETag');
        $this->asUser('alice')
            ->withHeaders(['If-Match' => $sharedEtag])
            ->patchJson('/api/v1/notes/items/'.$id, ['yjs' => [9, 9]])
            ->assertForbidden();
        $this->assertSame(self::BINARY, $this->storedState($id)['bytes']);
    }

    public function test_guest_cannot_read_yjs_state(): void
    {
        $note = $this->createNote();
        $token = app(JwtTokenService::class)->issue([
            'sub' => 'guest',
            'role' => 'guest',
            'exp' => time() + 3600,
        ]);

        $this->withBearer($token)
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertForbidden()
            ->assertJsonPath('code', 'forbidden');
    }

    public function test_yjs_response_is_octet_stream_with_nosniff(): void
    {
        $note = $this->createNote();
        $this->patchNote($note['id'], $note['etag'], ['yjs' => self::YJS])->assertOk();

        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }

    public function test_state_column_is_mediumblob_on_mysql(): void
    {
        $driver = DB::connection('wgw')->getDriverName();
        if ($driver !== 'mysql') {
            $column = collect(DB::connection('wgw')->select("PRAGMA table_info('note_yjs_state')"))
                ->firstWhere('name', 'state');
            $this->assertNotNull($column);
            $this->assertSame('blob', strtolower((string) $column->type));

            return;
        }

        $column = DB::connection('wgw')->selectOne(
            'select DATA_TYPE as data_type from information_schema.COLUMNS where TABLE_SCHEMA = database() and TABLE_NAME = ? and COLUMN_NAME = ?',
            ['note_yjs_state', 'state'],
        );
        $this->assertNotNull($column);
        $this->assertSame('mediumblob', strtolower((string) $column->data_type));
    }

    public function test_put_writes_markdown_title_and_state_under_the_state_etag(): void
    {
        $note = $this->createNote(body: 'original');

        $saved = $this->putState($note['id'], [
            'markdown' => 'rewritten',
            'title' => 'Renamed',
            'yjs' => self::YJS,
            'room' => $note['id'],
        ], ['If-None-Match' => '*'])->assertOk();

        $stateEtag = '"'.sha1(self::BINARY).'"';
        $this->assertSame($stateEtag, (string) $saved->headers->get('ETag'));
        $this->assertNotSame($note['etag'], $stateEtag);

        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('body', 'rewritten')
            ->assertJsonPath('title', 'Renamed');
        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertContent(self::BINARY)
            ->assertHeader('ETag', $stateEtag);
        $this->assertSame(
            (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag'),
            $this->storedState($note['id'])['object_etag'],
        );
    }

    public function test_state_etag_is_stable_across_a_metadata_change_and_moves_with_the_state(): void
    {
        $note = $this->createNote();
        $this->putState($note['id'], ['markdown' => 'Body', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();
        $before = '"'.sha1(self::BINARY).'"';
        $journal = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');

        $this->patchNote($note['id'], $journal, ['categories' => ['focus']])->assertOk();

        $this->asUser('bob')
            ->withHeaders(['If-None-Match' => $before])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertStatus(304)
            ->assertHeader('ETag', $before);

        $next = [9, 9, 9];
        $saved = $this->putState($note['id'], ['markdown' => 'Body', 'yjs' => $next], ['If-Match' => $before])
            ->assertOk();
        $this->assertSame('"'.sha1("\x09\x09\x09").'"', (string) $saved->headers->get('ETag'));
        $this->assertNotSame($before, (string) $saved->headers->get('ETag'));
    }

    public function test_put_refuses_a_stale_state_etag_and_a_missing_precondition(): void
    {
        $note = $this->createNote();
        $this->putState($note['id'], ['markdown' => 'Body', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();
        $before = $this->storedState($note['id']);

        $this->putState($note['id'], ['markdown' => 'other', 'yjs' => [3]], ['If-Match' => '"stale"'])
            ->assertStatus(412);
        $this->putState($note['id'], ['markdown' => 'other', 'yjs' => [3]], ['If-None-Match' => '*'])
            ->assertStatus(412);
        $this->putState($note['id'], ['markdown' => 'other', 'yjs' => [3]])
            ->assertStatus(428);

        $after = $this->storedState($note['id']);
        $this->assertSame($before['bytes'], $after['bytes']);
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('body', 'Body');
    }

    public function test_metadata_patch_still_uses_the_journal_etag(): void
    {
        $note = $this->createNote();
        $this->putState($note['id'], ['markdown' => 'Body', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();
        $stateEtag = '"'.sha1(self::BINARY).'"';
        $journal = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');
        $this->assertNotSame($stateEtag, $journal);

        $this->patchNote($note['id'], $journal, ['title' => 'From the journal tag'])->assertOk()
            ->assertJsonPath('title', 'From the journal tag');
        $this->patchNote($note['id'], $stateEtag, ['title' => 'Wrong tag'])->assertStatus(412);
    }

    public function test_put_omitted_title_does_not_clear_summary(): void
    {
        $note = $this->createNote(title: 'Keep me', body: 'Body');
        $this->putState($note['id'], ['markdown' => 'next', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();

        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('title', 'Keep me')
            ->assertJsonPath('body', 'next');
    }

    public function test_read_only_share_cannot_put_yjs_state(): void
    {
        $notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Read Only Put'])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$notebookId, [
            'shareWith' => ['alice' => ['mayReadItems' => true]],
        ])->assertOk();
        $created = $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Shared',
            'body' => 'secret',
        ])->assertCreated();
        $id = (string) $created->json('id');

        $this->asUser('alice')->putCollaboration(
            '/api/v1/notes/items/'.$id,
            'nope',
            self::BINARY,
            ['If-None-Match' => '*'],
        )->assertForbidden();
        $this->asUser('alice')
            ->get('/api/v1/notes/items/'.$id.'?format=yjs')
            ->assertNoContent();
    }

    public function test_external_description_is_flagged_on_the_next_read_without_rewriting_state(): void
    {
        $note = $this->createNote(body: 'original');
        $this->putState($note['id'], ['markdown' => 'original', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();
        $before = $this->storedState($note['id']);

        $this->rewriteViaCalDav($note['id'], ['body' => 'from outside']);

        $stateEtag = '"'.sha1(self::BINARY).'"';
        $state = $this->asUser('bob')
            ->withHeaders(['If-None-Match' => $stateEtag])
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertHeader('ETag', $stateEtag)
            ->assertHeader(NoteYjsProjection::EXTERNAL_WRITE_HEADER, '1');
        $this->assertSame(self::BINARY, $state->getContent());
        $this->assertSame($before['bytes'], $this->storedState($note['id'])['bytes']);

        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('body', 'from outside');

        $this->putState($note['id'], [
            'markdown' => 'from outside',
            'yjs' => [4, 5, 6],
        ], ['If-Match' => $stateEtag])->assertOk();

        $again = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertContent("\x04\x05\x06");
        $this->assertFalse($again->headers->has(NoteYjsProjection::EXTERNAL_WRITE_HEADER));
    }

    public function test_external_summary_is_flagged_on_the_next_read(): void
    {
        $note = $this->createNote(title: 'Inside', body: 'Body');
        $this->putState($note['id'], [
            'markdown' => 'Body',
            'title' => 'Inside',
            'yjs' => self::YJS,
        ], ['If-None-Match' => '*'])->assertOk();

        $this->rewriteViaCalDav($note['id'], ['title' => 'Outside']);

        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertHeader(NoteYjsProjection::EXTERNAL_WRITE_HEADER, '1')
            ->assertContent(self::BINARY);
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('title', 'Outside')
            ->assertJsonPath('body', 'Body');
    }

    public function test_external_tag_move_archive_and_delete_are_not_content_writes(): void
    {
        $note = $this->createNote(body: 'Body');
        $this->putState($note['id'], ['markdown' => 'Body', 'yjs' => self::YJS], ['If-None-Match' => '*'])
            ->assertOk();

        $this->rewriteViaCalDav($note['id'], ['categories' => ['outside']]);
        $tagged = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertContent(self::BINARY);
        $this->assertFalse($tagged->headers->has(NoteYjsProjection::EXTERNAL_WRITE_HEADER));
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('body', 'Body')
            ->assertJsonPath('categories', ['outside']);

        $this->rewriteViaCalDav($note['id'], ['status' => 'CANCELLED']);
        $archived = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk();
        $this->assertFalse($archived->headers->has(NoteYjsProjection::EXTERNAL_WRITE_HEADER));
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('status', 'CANCELLED')
            ->assertJsonPath('body', 'Body');

        $dest = (string) $this->asUser('bob')->postJson('/api/v1/notes/notebooks', ['name' => 'Moved'])
            ->assertCreated()
            ->json('id');
        $journal = (string) $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])->headers->get('ETag');
        $this->patchNote($note['id'], $journal, ['notebookId' => $dest])->assertOk();
        $moved = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertOk()
            ->assertContent(self::BINARY);
        $this->assertFalse($moved->headers->has(NoteYjsProjection::EXTERNAL_WRITE_HEADER));

        $this->deleteViaCalDav($note['id']);
        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNotFound();
        $this->assertSame(0, NoteYjsState::query()->where('note_uid', $note['id'])->count());
    }

    public function test_missing_yjs_row_stays_a_normal_empty_read(): void
    {
        $note = $this->createNote(body: 'Created outside');

        $response = $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNoContent();
        $this->assertFalse($response->headers->has('ETag'));
        $this->assertFalse($response->headers->has(NoteYjsProjection::EXTERNAL_WRITE_HEADER));
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$note['id'])
            ->assertOk()
            ->assertJsonPath('body', 'Created outside');
    }

    public function test_put_rejects_a_json_body(): void
    {
        $note = $this->createNote();

        $this->asUser('bob')->putJson('/api/v1/notes/items/'.$note['id'], [
            'markdown' => 'Body',
            'yjs' => self::YJS,
        ], ['If-None-Match' => '*'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'invalid_body');

        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNoContent();
    }

    public function test_put_rejects_yjs_one_byte_over_the_cap(): void
    {
        $note = $this->createNote();
        $over = str_repeat("\xab", YjsBytes::MAX_BYTES + 1);

        $this->asUser('bob')->putCollaboration(
            '/api/v1/notes/items/'.$note['id'],
            'over',
            $over,
            ['If-None-Match' => '*'],
        )->assertStatus(413)->assertJsonPath('code', 'payload_too_large');

        $this->asUser('bob')
            ->get('/api/v1/notes/items/'.$note['id'].'?format=yjs')
            ->assertNoContent();
    }

    /**
     * @param  array<string, mixed>  $patch
     */
    private function rewriteViaCalDav(string $noteId, array $patch): void
    {
        $object = CalendarObject::query()->where('uid', $noteId)->where('componenttype', 'VJOURNAL')->first();
        $this->assertNotNull($object);
        $instance = CalendarInstance::query()->where('calendarid', (int) $object->calendarid)->first();
        $this->assertNotNull($instance);
        $raw = is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
        $ics = app(NoteJournalConverter::class)->mergeIntoIcs($raw, $patch);
        $this->calDav()->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            $ics,
        );
    }

    private function deleteViaCalDav(string $noteId): void
    {
        $object = CalendarObject::query()->where('uid', $noteId)->where('componenttype', 'VJOURNAL')->first();
        $this->assertNotNull($object);
        $instance = CalendarInstance::query()->where('calendarid', (int) $object->calendarid)->first();
        $this->assertNotNull($instance);
        $this->calDav()->deleteCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
        );
    }

    private function calDav(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, string>  $headers
     */
    private function putState(string $id, array $payload, array $headers = []): TestResponse
    {
        // withHeaders sticks to later requests in this test. A leftover
        // If-None-Match would turn the next GET into a 304 and the next PUT
        // into a 412.
        $previous = $this->defaultHeaders;
        try {
            $yjs = $payload['yjs'] ?? null;
            $title = $payload['title'] ?? null;

            return $this->asUser('bob')->putCollaboration(
                '/api/v1/notes/items/'.$id,
                is_string($payload['markdown'] ?? null) ? $payload['markdown'] : null,
                is_array($yjs) ? YjsBytes::decode($yjs) : null,
                $headers,
                is_string($title) ? $title : null,
            );
        } finally {
            $this->defaultHeaders = $previous;
        }
    }

    /**
     * @return array{id: string, etag: string}
     */
    private function createNote(string $title = 'Title', string $body = 'Body'): array
    {
        $created = $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => $title,
            'body' => $body,
        ])->assertCreated();

        return [
            'id' => (string) $created->json('id'),
            'etag' => (string) $created->headers->get('ETag'),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function patchNote(string $id, string $etag, array $payload): TestResponse
    {
        return $this->asUser('bob')->withHeaders(['If-Match' => $etag])->patchJson('/api/v1/notes/items/'.$id, $payload);
    }

    /**
     * @return array{bytes: string, object_etag: string}
     */
    private function storedState(string $noteId): array
    {
        $objectId = (int) CalendarObject::query()->where('uid', $noteId)->value('id');
        $row = NoteYjsState::query()->where('calendar_object_id', $objectId)->first();
        $this->assertNotNull($row);

        return [
            'bytes' => $this->binaryOf($row),
            'object_etag' => (string) $row->object_etag,
        ];
    }

    private function binaryOf(NoteYjsState $row): string
    {
        $state = $row->getAttributes()['state'] ?? null;
        if (is_resource($state)) {
            $contents = stream_get_contents($state);

            return is_string($contents) ? $contents : '';
        }

        return is_string($state) ? $state : '';
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

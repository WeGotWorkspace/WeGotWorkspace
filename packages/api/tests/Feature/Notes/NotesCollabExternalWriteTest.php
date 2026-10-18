<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Notes\Conversion\NoteJournalConverter;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #1381: a client with the note open still holds the current Yjs-state tag.
 * Its next save must not write over an outside CalDAV edit it never saw.
 */
final class NotesCollabExternalWriteTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;
    use SendsFramedCollaboration;

    private const STATE = "\x00\x01\x02\xff";

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    public function test_a_save_over_an_outside_edit_is_refused(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);

        $this->save($id, 'Body, edited', 'Inside', ['If-Match' => $this->stateEtag()])
            ->assertStatus(409)
            ->assertJsonPath('error', 'external_write');

        $this->readNote($id)
            ->assertOk()
            ->assertJsonPath('body', 'From outside');
        $this->assertSame(self::STATE, $this->storedState($id));
    }

    public function test_an_outside_title_edit_is_refused_too(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['title' => 'Outside']);

        $this->save($id, 'Body', 'Inside', ['If-Match' => $this->stateEtag()])->assertStatus(409);

        $this->readNote($id)->assertOk()->assertJsonPath('title', 'Outside');
    }

    public function test_a_save_that_names_the_content_it_saw_is_accepted(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);
        $seen = $this->seenContentEtag($id);

        $this->save($id, 'Body, kept', 'Inside', [
            'If-Match' => $this->stateEtag(),
            CollabExternalWrite::HEADER => $seen,
        ])->assertOk();

        $this->readNote($id)->assertOk()->assertJsonPath('body', 'Body, kept');
        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->get('/api/v1/notes/items/'.$id.'?format=yjs')
            ->assertOk()
            ->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_the_content_tag_survives_a_metadata_change(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);
        $seen = $this->seenContentEtag($id);
        $this->rewriteViaCalDav($id, ['categories' => ['tagged-outside']]);

        $this->save($id, 'Body, kept', 'Inside', [
            'If-Match' => $this->stateEtag(),
            CollabExternalWrite::HEADER => $seen,
        ])->assertOk();
    }

    public function test_a_save_that_saw_older_content_is_refused(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);
        $seen = $this->seenContentEtag($id);
        $this->rewriteViaCalDav($id, ['body' => 'From outside again']);

        $this->save($id, 'Body, kept', 'Inside', [
            'If-Match' => $this->stateEtag(),
            CollabExternalWrite::HEADER => $seen,
        ])->assertStatus(409);

        $this->readNote($id)->assertOk()->assertJsonPath('body', 'From outside again');
    }

    public function test_a_wildcard_or_empty_acknowledgement_is_refused(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);

        foreach (['*', ' ', 'W/*'] as $seen) {
            $this->save($id, 'Body, kept', 'Inside', [
                'If-Match' => $this->stateEtag(),
                CollabExternalWrite::HEADER => $seen,
            ])->assertStatus(409);
        }
    }

    public function test_a_metadata_only_change_does_not_refuse_the_save(): void
    {
        $id = $this->noteSavedThroughTheApp('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['categories' => ['tagged-outside'], 'status' => 'CANCELLED']);

        $this->save($id, 'Body, edited', 'Inside', ['If-Match' => $this->stateEtag()])->assertOk();
    }

    public function test_a_save_without_a_state_row_is_not_refused(): void
    {
        $id = $this->createNote('Inside', 'Body');
        $this->rewriteViaCalDav($id, ['body' => 'From outside']);

        $this->save($id, 'Body, edited', 'Inside', ['If-None-Match' => '*'])->assertOk();
    }

    public function test_the_note_json_carries_its_content_tag(): void
    {
        $id = $this->createNote('Inside', 'Body');

        $this->readNote($id)
            ->assertOk()
            ->assertJsonPath('contentEtag', '"'.sha1("Body\0Inside").'"');
    }

    private function noteSavedThroughTheApp(string $title, string $body): string
    {
        $id = $this->createNote($title, $body);
        $this->save($id, $body, $title, ['If-None-Match' => '*'])->assertOk();

        return $id;
    }

    private function stateEtag(): string
    {
        return '"'.sha1(self::STATE).'"';
    }

    /** What the client showed in the dialog: the `contentEtag` of the note JSON. */
    private function seenContentEtag(string $id): string
    {
        return (string) $this->readNote($id)->assertOk()->json('contentEtag');
    }

    /**
     * @param  array<string, string>  $headers
     */
    private function save(string $id, string $markdown, string $title, array $headers): TestResponse
    {
        $previous = $this->defaultHeaders;
        try {
            return $this->withBearer($this->issueBearerTokenFor('bob'))
                ->putCollaboration('/api/v1/notes/items/'.$id, $markdown, self::STATE, $headers, $title);
        } finally {
            $this->defaultHeaders = $previous;
        }
    }

    private function createNote(string $title, string $body): string
    {
        return (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => $title,
                'body' => $body,
            ])
            ->assertCreated()
            ->json('id');
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
        (new CalPDO(DB::connection('wgw')->getPdo()))->updateCalendarObject(
            [(int) $instance->calendarid, (int) $instance->id],
            (string) $object->uri,
            app(NoteJournalConverter::class)->mergeIntoIcs($raw, $patch),
        );
    }

    private function storedState(string $noteId): string
    {
        $objectId = (int) CalendarObject::query()->where('uid', $noteId)->value('id');
        $row = NoteYjsState::query()->where('calendar_object_id', $objectId)->first();
        $this->assertNotNull($row);
        $state = $row->getAttributes()['state'] ?? null;
        if (is_resource($state)) {
            $state = stream_get_contents($state);
        }

        return is_string($state) ? $state : '';
    }

    private function readNote(string $id): TestResponse
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'))->getJson('/api/v1/notes/items/'.$id);
    }
}

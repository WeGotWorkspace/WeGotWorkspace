<?php

declare(strict_types=1);

namespace Tests\Unit\Collab;

use App\Exceptions\ApiHttpException;
use App\Models\CalendarObject;
use App\Models\NoteYjsState;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Collab\CollabTextFields;
use App\Services\Collab\CollabTextState;
use App\Services\Notes\NoteTextFields;
use App\Services\Notes\NoteYjsProjection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The live-text rules Notes and Tasks share (#2208): one copy, so the two
 * apps cannot drift apart on what an outside write is.
 */
final class CollabTextStateTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private CollabTextState $core;

    #[\Override]
    protected function setUp(): void
    {
        parent::setUp();
        $this->core = new CollabTextState;
        $this->configureWgwJwtKeys();
    }

    public function test_the_content_tag_hashes_the_fields_in_the_order_given(): void
    {
        $this->assertSame(sha1("Body\0Title"), CollabTextState::hashFields(['Body', 'Title']));
        $this->assertNotSame(
            CollabTextState::hashFields(['Body', 'Title']),
            CollabTextState::hashFields(['Title', 'Body']),
        );
    }

    public function test_a_notes_content_tag_stored_before_the_shared_core_still_matches(): void
    {
        // The hash `NoteYjsProjection::hashContent` wrote into every existing row.
        $before = static fn (string $body, ?string $title): string => hash('sha1', $body."\0".($title ?? ''));

        $this->assertSame($before('Body', 'Title'), NoteYjsProjection::hashContent('Body', 'Title'));
        $this->assertSame($before('Body', null), NoteYjsProjection::hashContent('Body', null));
        $this->assertSame($before('', ''), CollabTextState::hashFields(['', '']));
    }

    /**
     * @return iterable<string, array{string|null, string|null, string|null, int|null}>
     */
    public static function preconditions(): iterable
    {
        $tag = '"'.sha1('state').'"';

        yield 'first save without a precondition' => [null, null, null, null];
        yield 'no precondition over a stored state' => [null, null, $tag, 428];
        yield 'create over a stored state' => [null, '*', $tag, 412];
        yield 'create with no stored state' => [null, '*', null, null];
        yield 'If-Match on the stored state' => [$tag, null, $tag, null];
        yield 'If-Match on an older state' => ['"'.sha1('older').'"', null, $tag, 412];
    }

    #[DataProvider('preconditions')]
    public function test_the_state_precondition(?string $ifMatch, ?string $ifNoneMatch, ?string $stored, ?int $status): void
    {
        $this->assertStatus($status, fn () => $this->core->assertStatePrecondition($ifMatch, $ifNoneMatch, $stored));
    }

    public function test_the_header_names_the_current_text_and_never_matches_a_star(): void
    {
        $fields = $this->fields();
        $object = $this->object('etag-1', ['Body', 'Title']);
        $current = $this->core->contentTag($fields, $object);

        $this->assertTrue($this->core->namesContent($fields, $current, $object));
        $this->assertTrue($this->core->namesContent($fields, 'W/'.$current, $object));
        $this->assertTrue($this->core->namesContent($fields, '"older", '.$current, $object));
        $this->assertFalse($this->core->namesContent($fields, '*', $object));
        $this->assertFalse($this->core->namesContent($fields, '', $object));
        $this->assertFalse($this->core->namesContent($fields, '"'.CollabTextState::hashFields(['Old', 'Title']).'"', $object));
    }

    public function test_a_metadata_write_is_not_an_outside_write(): void
    {
        $fields = $this->fields();
        $row = $this->row('"etag-1"', CollabTextState::hashFields(['Body', 'Title']));

        // Same object: nothing moved.
        $this->assertFalse($this->core->isExternalContentWrite($fields, $row, $this->object('etag-1', ['Body', 'Title'])));
        // The object moved (status, due, tags) but its text did not.
        $this->assertFalse($this->core->isExternalContentWrite($fields, $row, $this->object('etag-2', ['Body', 'Title'])));
        // The object moved and its text with it.
        $this->assertTrue($this->core->isExternalContentWrite($fields, $row, $this->object('etag-2', ['Other', 'Title'])));
        $this->assertTrue($this->core->isExternalContentWrite($fields, $row, $this->object('etag-2', ['Body', 'Other'])));
    }

    public function test_a_row_without_a_content_tag_counts_as_an_outside_write_once_the_object_moved(): void
    {
        $fields = $this->fields();
        $row = $this->row('"etag-1"', null);

        $this->assertFalse($this->core->isExternalContentWrite($fields, $row, $this->object('etag-1', ['Body'])));
        $this->assertTrue($this->core->isExternalContentWrite($fields, $row, $this->object('etag-2', ['Body'])));
    }

    public function test_a_save_over_an_unseen_outside_write_is_refused(): void
    {
        $fields = $this->fields();
        $row = $this->row('"etag-1"', CollabTextState::hashFields(['Body', 'Title']));
        $moved = $this->object('etag-2', ['Outside', 'Title']);
        $seen = $this->core->contentTag($fields, $moved);

        $this->assertStatus(409, fn () => $this->core->assertNoUnseenExternalWrite($fields, $row, $moved, null));
        $this->assertStatus(409, fn () => $this->core->assertNoUnseenExternalWrite($fields, $row, $moved, '*'));
        $this->assertStatus(null, fn () => $this->core->assertNoUnseenExternalWrite($fields, $row, $moved, $seen));
        // A metadata write needs no acknowledgement.
        $this->assertStatus(null, fn () => $this->core->assertNoUnseenExternalWrite(
            $fields,
            $row,
            $this->object('etag-2', ['Body', 'Title']),
            null,
        ));
    }

    public function test_the_first_save_check_refuses_a_save_seeded_from_older_text(): void
    {
        $fields = $this->fields();
        $seededFrom = '"'.CollabTextState::hashFields(['Body', 'Title']).'"';
        $now = $this->object('etag-2', ['Outside', 'Title']);

        $this->assertStatus(409, fn () => $this->core->assertNoUnseenExternalWrite($fields, null, $now, $seededFrom));
        $this->assertStatus(409, fn () => $this->core->assertNoUnseenExternalWrite($fields, null, $now, '*'));
        $this->assertStatus(null, fn () => $this->core->assertNoUnseenExternalWrite(
            $fields,
            null,
            $this->object('etag-2', ['Body', 'Title']),
            $seededFrom,
        ));
        // A first save that names nothing (Notes today) is not checked.
        $this->assertStatus(null, fn () => $this->core->assertNoUnseenExternalWrite($fields, null, $now, null));
        $this->assertStatus(null, fn () => $this->core->assertNoUnseenExternalWrite($fields, null, $now, '  '));
    }

    public function test_the_state_cap_is_the_apps(): void
    {
        $capped = $this->fields(256 * 1024);

        $this->assertStatus(null, fn () => $this->core->assertStateSize($capped, str_repeat("\x01", 256 * 1024)));
        $this->assertStatus(413, fn () => $this->core->assertStateSize($capped, str_repeat("\x01", 256 * 1024 + 1)));
        $this->assertStatus(null, fn () => $this->core->assertStateSize($this->fields(), str_repeat("\x01", 256 * 1024 + 1)));

        try {
            $this->core->assertStateSize($capped, str_repeat("\x01", 256 * 1024 + 1));
        } catch (ApiHttpException $exception) {
            $this->assertSame('state_too_large', $exception->errorCode());
        }
    }

    public function test_the_locked_write_reads_the_object_and_its_state_again_under_the_lock(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        $noteId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Title',
                'body' => 'Body',
            ])
            ->assertCreated()
            ->json('id');
        $fields = app(NoteTextFields::class);
        $stale = CalendarObject::query()->where('uid', $noteId)->firstOrFail();

        // Another writer lands between the caller's lookup and its write.
        CalendarObject::query()->whereKey($stale->getKey())->update(['etag' => 'moved-on']);
        $this->core->store($fields, CalendarObject::query()->whereKey($stale->getKey())->firstOrFail(), "\x01\x02");

        $seen = $this->core->locked($fields, $stale, 'Note not found.', function (CalendarObject $object, ?Model $row): array {
            return [
                'etag' => (string) $object->etag,
                'state' => $row === null ? null : $this->core->stateBytes($row),
                'inTransaction' => DB::connection('wgw')->transactionLevel() > 0,
            ];
        });

        $this->assertSame(['etag' => 'moved-on', 'state' => "\x01\x02", 'inTransaction' => true], $seen);
    }

    public function test_storing_keeps_the_object_etag_and_content_tag_beside_the_state(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        $noteId = (string) $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/notes/items', [
                'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
                'title' => 'Title',
                'body' => 'Body',
            ])
            ->assertCreated()
            ->json('id');
        $object = CalendarObject::query()->where('uid', $noteId)->firstOrFail();

        $etag = $this->core->store(app(NoteTextFields::class), $object, "\x05");

        $row = NoteYjsState::query()->where('calendar_object_id', (int) $object->id)->firstOrFail();
        $this->assertSame('"'.sha1("\x05").'"', $etag);
        $this->assertSame($this->core->objectEtag($object), $row->object_etag);
        $this->assertSame(NoteYjsProjection::hashContent('Body', 'Title'), $row->content_etag);
        $this->assertSame($noteId, $row->note_uid);
    }

    /** Fields read from the object's data, one per line; nothing is stored. */
    private function fields(?int $maxStateBytes = null): CollabTextFields
    {
        return new class($maxStateBytes) implements CollabTextFields
        {
            public function __construct(private readonly ?int $maxStateBytes) {}

            #[\Override]
            public function textFields(CalendarObject $object): array
            {
                return explode("\n", (string) $object->calendardata);
            }

            #[\Override]
            public function findState(CalendarObject $object): ?Model
            {
                return null;
            }

            #[\Override]
            public function storeState(CalendarObject $object, array $columns): void {}

            #[\Override]
            public function maxStateBytes(): ?int
            {
                return $this->maxStateBytes;
            }
        };
    }

    /**
     * @param  list<string>  $fields
     */
    private function object(string $etag, array $fields): CalendarObject
    {
        return (new CalendarObject)->forceFill([
            'etag' => $etag,
            'calendardata' => implode("\n", $fields),
        ]);
    }

    private function row(string $objectEtag, ?string $contentTag): NoteYjsState
    {
        return (new NoteYjsState)->forceFill([
            'state' => "\x00",
            'object_etag' => $objectEtag,
            'content_etag' => $contentTag,
        ]);
    }

    private function assertStatus(?int $status, callable $call): void
    {
        try {
            $call();
        } catch (ApiHttpException $exception) {
            $this->assertSame($status, $exception->getStatusCode(), $exception->getMessage());

            return;
        }
        $this->assertNull($status, 'Expected HTTP '.$status);
    }
}

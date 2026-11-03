<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A note with only a title has an empty body. Its collab save sends an empty
 * markdown field; that was rejected with 400 ("markdown is required"), so the
 * title typed in the document never reached SUMMARY.
 */
final class NotesCollabEmptyBodyTest extends WgwDatabaseTestCase
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

    public function test_a_title_only_note_saves_with_an_empty_body(): void
    {
        $id = (string) $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => null,
            'body' => '',
        ])->assertCreated()->json('id');

        $this->asBob()->putCollaboration(
            '/api/v1/notes/items/'.$id,
            '',
            self::STATE,
            ['If-None-Match' => '*'],
            'Only a title',
        )->assertOk();

        $this->asBob()->getJson('/api/v1/notes/items/'.$id)
            ->assertOk()
            ->assertJsonPath('title', 'Only a title');
    }

    public function test_a_missing_markdown_field_is_still_rejected(): void
    {
        $id = (string) $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'body' => '',
        ])->assertCreated()->json('id');

        $this->asBob()->putCollaboration('/api/v1/notes/items/'.$id, null, self::STATE)
            ->assertStatus(400);
    }

    private function asBob(): self
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
    }
}

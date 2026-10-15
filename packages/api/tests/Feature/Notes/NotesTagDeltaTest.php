<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Illuminate\Testing\TestResponse;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

final class NotesTagDeltaTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
    }

    public function test_categories_add_appends_to_stored_tags(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $this->patchTags($id, $etag, ['categoriesAdd' => ['B']])
            ->assertOk()
            ->assertJsonPath('categories', ['a', 'b']);
    }

    public function test_categories_remove_drops_a_stored_tag(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a', 'b']);

        $this->patchTags($id, $etag, ['categoriesRemove' => ['a']])
            ->assertOk()
            ->assertJsonPath('categories', ['b']);
    }

    public function test_categories_add_and_remove_apply_together(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $this->patchTags($id, $etag, [
            'categoriesRemove' => ['a'],
            'categoriesAdd' => ['b'],
        ])->assertOk()->assertJsonPath('categories', ['b']);
    }

    public function test_a_tag_listed_in_both_delta_fields_stays(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['keep', 'a']);

        // Remove then add: `a` is still there, and `b` is new. Add-then-remove
        // would drop `a`. Ignoring the delta would leave the original set.
        $this->patchTags($id, $etag, [
            'categoriesRemove' => ['a'],
            'categoriesAdd' => ['a', 'b'],
        ])->assertOk()->assertJsonPath('categories', ['keep', 'a', 'b']);
    }

    public function test_removing_an_unknown_tag_is_a_no_op(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $this->patchTags($id, $etag, ['categoriesRemove' => ['missing']])
            ->assertOk()
            ->assertJsonPath('categories', ['a']);
    }

    public function test_adding_a_tag_that_is_already_stored_does_not_duplicate_it(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $first = $this->patchTags($id, $etag, ['categoriesAdd' => ['a', 'b', 'b']])
            ->assertOk();
        $first->assertJsonPath('categories', ['a', 'b']);

        $this->patchTags($id, $this->etagOf($first), ['categoriesAdd' => ['a']])
            ->assertOk()
            ->assertJsonPath('categories', ['a']);
    }

    public function test_invalid_categories_add_is_rejected_and_the_same_value_may_be_removed(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $this->patchTags($id, $etag, ['categoriesAdd' => ['Foo Bar']])
            ->assertStatus(400)
            ->assertJsonPath('code', 'bad_request');

        $this->asBob()->getJson('/api/v1/notes/items/'.$id)
            ->assertOk()
            ->assertJsonPath('categories', ['a']);

        $this->patchTags($id, $etag, ['categoriesRemove' => ['Foo Bar']])
            ->assertOk()
            ->assertJsonPath('categories', ['a']);
    }

    public function test_categories_combined_with_a_delta_is_rejected(): void
    {
        ['id' => $id, 'etag' => $etag] = $this->createNote(['a']);

        $this->patchTags($id, $etag, [
            'categories' => ['a', 'b'],
            'categoriesAdd' => ['b'],
        ])->assertStatus(400)->assertJsonPath('code', 'bad_request');

        $this->patchTags($id, $etag, [
            'categories' => ['a'],
            'categoriesRemove' => ['a'],
        ])->assertStatus(400)->assertJsonPath('code', 'bad_request');

        $this->asBob()->getJson('/api/v1/notes/items/'.$id)
            ->assertOk()
            ->assertJsonPath('categories', ['a']);
    }

    public function test_two_clients_adding_different_tags_both_keep_them_when_the_second_uses_a_fresh_etag(): void
    {
        ['id' => $id, 'etag' => $shared] = $this->createNote(['a']);

        $fromA = $this->patchTags($id, $shared, ['categoriesAdd' => ['x']])
            ->assertOk();
        $fromA->assertJsonPath('categories', ['a', 'x']);

        // B read the same note as A, then fetched the ETag that A's write produced.
        // The body is only "add y" — it does not resend A's tag. A replace of
        // B's original snapshot would have dropped x.
        $this->patchTags($id, $this->etagOf($fromA), ['categoriesAdd' => ['y']])
            ->assertOk()
            ->assertJsonPath('categories', ['a', 'x', 'y']);
    }

    /**
     * @param  list<string>  $categories
     * @return array{id: string, etag: string}
     */
    private function createNote(array $categories): array
    {
        $created = $this->asBob()->postJson('/api/v1/notes/items', [
            'notebookId' => CalendarCollectionUris::NOTE_GENERAL,
            'title' => 'Tagged',
            'categories' => $categories,
        ])->assertCreated();

        return [
            'id' => (string) $created->json('id'),
            'etag' => $this->etagOf($created),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function patchTags(string $id, string $etag, array $payload): TestResponse
    {
        return $this->asBob()
            ->withHeaders(['If-Match' => $etag])
            ->patchJson('/api/v1/notes/items/'.$id, $payload);
    }

    private function etagOf(TestResponse $response): string
    {
        $header = $response->headers->get('ETag');
        if (is_string($header) && $header !== '') {
            return $header;
        }
        $json = $response->json('etag');
        $this->assertIsString($json);

        return $json;
    }

    private function asBob()
    {
        return $this->withBearer($this->issueBearerTokenFor('bob'));
    }
}

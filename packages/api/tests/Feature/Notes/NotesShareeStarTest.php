<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A star is per user: someone a notebook is shared with may star its notes
 * like their own, without changing the note or what anyone else sees.
 */
final class NotesShareeStarTest extends WgwDatabaseTestCase
{
    use SeedsWgwIdentity;

    private string $notebookId;

    private string $noteId;

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        foreach (['bob' => 'Bob', 'alice' => 'Alice', 'carol' => 'Carol'] as $username => $name) {
            $this->seedWgwUser($username, displayName: $name);
            app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/'.$username);
        }

        $this->notebookId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Team Notes'])
            ->assertCreated()
            ->json('id');
        $this->noteId = (string) $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => $this->notebookId,
            'title' => 'Plan',
            'body' => 'body',
        ])->assertCreated()->json('id');
    }

    public function test_a_view_only_sharee_can_star_and_unstar_for_themselves(): void
    {
        $this->shareWithAlice();

        $this->asUser('alice')->postJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertOk();

        $this->assertSame([$this->noteId], $this->starredIds('alice'));
        $this->asUser('alice')->getJson('/api/v1/notes/items/'.$this->noteId)
            ->assertOk()
            ->assertJsonPath('starred', true);

        $this->asUser('alice')->deleteJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertOk();

        $this->assertSame([], $this->starredIds('alice'));
    }

    public function test_a_sharee_star_is_invisible_to_the_owner(): void
    {
        $this->shareWithAlice();

        $this->asUser('alice')->postJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertOk();

        $this->assertSame([], $this->starredIds('bob'));
        $this->asUser('bob')->getJson('/api/v1/notes/items/'.$this->noteId)
            ->assertOk()
            ->assertJsonPath('starred', false);
    }

    public function test_a_caller_without_access_cannot_star_or_unstar(): void
    {
        $this->shareWithAlice();

        $this->asUser('carol')->postJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertNotFound();
        $this->asUser('carol')->deleteJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertNotFound();

        $this->assertSame([], $this->starredIds('carol'));
    }

    public function test_losing_access_hides_the_star_and_regaining_access_shows_it_again(): void
    {
        $this->shareWithAlice();
        $this->asUser('alice')->postJson('/api/v1/notes/items/'.$this->noteId.'/star')->assertOk();

        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$this->notebookId, [
            'shareWith' => ['alice' => null],
        ])->assertOk();

        $this->assertSame([], $this->starredIds('alice'));

        $this->shareWithAlice();

        $this->assertSame([$this->noteId], $this->starredIds('alice'));
    }

    private function shareWithAlice(): void
    {
        $this->asUser('bob')->patchJson('/api/v1/notes/notebooks/'.$this->notebookId, [
            'shareWith' => ['alice' => ['mayReadItems' => true]],
        ])->assertOk();
    }

    /**
     * @return list<string>
     */
    private function starredIds(string $username): array
    {
        $list = $this->asUser($username)->getJson('/api/v1/notes/items?starred=true')->assertOk()->json('list');

        return array_values(array_map(static fn (array $note): string => (string) $note['id'], (array) $list));
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\Principal;
use App\Services\Calendars\CalendarCollectionUris;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use Tests\Support\WgwDatabaseTestCase;

final class NotesGroupNotebookWriteTest extends WgwDatabaseTestCase
{
    private const GROUP_SLUG = 'eng';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('carol', displayName: 'Carol');

        $bob = Principal::forUsername('bob');
        $this->assertNotNull($bob);
        $team = $this->seedWgwGroup('principals/groups/'.self::GROUP_SLUG, 'Engineering');
        $this->addPrincipalToGroup($team, $bob);

        app(UserCalendarCollectionsProvisioner::class)->ensureForGroupPrincipal(
            'principals/groups/'.self::GROUP_SLUG,
            'Engineering',
        );
    }

    public function test_create_in_a_group_notebook_persists_and_lists(): void
    {
        $notebookId = CalendarCollectionUris::groupNotebookApiId(self::GROUP_SLUG);

        $created = $this->asUser('bob')->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Standup',
            'body' => 'Shipped the notes fix',
        ])->assertCreated();
        $created->assertJsonPath('notebookId', $notebookId);
        $id = (string) $created->json('id');

        $list = $this->asUser('bob')
            ->getJson('/api/v1/notes/items?notebookId='.$notebookId)
            ->assertOk()
            ->json('list');
        $this->assertContains($id, array_column($list, 'id'));
    }

    public function test_create_in_a_group_notebook_is_rejected_for_a_non_member(): void
    {
        $notebookId = CalendarCollectionUris::groupNotebookApiId(self::GROUP_SLUG);

        $this->asUser('carol')->postJson('/api/v1/notes/items', [
            'notebookId' => $notebookId,
            'title' => 'Not mine',
            'body' => 'Should not land',
        ])->assertNotFound();
    }

    private function asUser(string $username)
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

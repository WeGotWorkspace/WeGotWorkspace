<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use App\Models\Principal;
use App\Services\Calendars\UserCalendarCollectionsProvisioner;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CollectionMetadataStateAssertions;
use Tests\Support\SeedsWgwIdentity;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Renaming or recolouring a notebook moves the Notebook state of everyone who
 * can see it, from the app and from a DAV client alike (#1671).
 */
final class NotebookMetadataStateTest extends WgwDatabaseTestCase
{
    use CollectionMetadataStateAssertions;
    use SeedsWgwIdentity;

    private const TEAM = 'team';

    protected function setUp(): void
    {
        parent::setUp();
        $this->configureWgwJwtKeys();
        $this->setUpDavServer();
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/bob');
        app(UserCalendarCollectionsProvisioner::class)->ensureForPrincipal('principals/alice');
        $team = $this->seedWgwGroup('principals/groups/'.self::TEAM, 'Team');
        $this->addPrincipalToGroup($team, $this->principal('bob'));
        $this->addPrincipalToGroup($team, $this->principal('alice'));
    }

    public function test_rename_and_recolour_in_the_app_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedNotebook('Projects');
        $before = $this->restStates();
        $jmapBefore = $this->jmapNotebookState('alice');

        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$ownerId, ['name' => 'Projects 2027', 'color' => '#ff0000'])
            ->assertOk()
            ->assertJsonPath('name', 'Projects 2027')
            ->assertJsonPath('color', '#ff0000');

        $this->assertCollectionUpdated($this->restChanges('bob', $before['bob']), $before['bob'], $ownerId, 'bob (REST)');
        $this->assertCollectionUpdated($this->restChanges('alice', $before['alice']), $before['alice'], $shareeId, 'alice (REST)');
        $this->assertCollectionUpdated($this->jmapChanges('alice', $jmapBefore), $jmapBefore, $shareeId, 'alice (JMAP)');
    }

    public function test_dav_proppatch_rename_and_recolour_moves_state_for_owner_and_sharee(): void
    {
        [$ownerId, $shareeId] = $this->sharedNotebook('Field notes');
        $before = $this->restStates();
        $jmapBefore = $this->jmapNotebookState('alice');

        $this->davProppatch('bob', '/calendars/bob/'.$ownerId, [
            '{DAV:}displayname' => 'Field notes 2027',
            self::APPLE_CALENDAR_COLOR => '#00ff00',
        ]);

        $this->assertCollectionUpdated($this->restChanges('bob', $before['bob']), $before['bob'], $ownerId, 'bob (REST)');
        $this->assertCollectionUpdated($this->restChanges('alice', $before['alice']), $before['alice'], $shareeId, 'alice (REST)');
        $this->assertCollectionUpdated($this->jmapChanges('alice', $jmapBefore), $jmapBefore, $shareeId, 'alice (JMAP)');

        $owned = $this->asUser('bob')->getJson('/api/v1/notes/notebooks/'.$ownerId)->assertOk();
        $this->assertSame('Field notes 2027', $owned->json('name'));
        $this->assertSame('#00ff00', $owned->json('color'));
    }

    public function test_group_notebook_rename_reaches_every_member(): void
    {
        $id = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => 'Team notes', 'groupSlug' => self::TEAM])
            ->assertCreated()
            ->json('id');
        $this->assertSame('Team notes', $this->notebookNamed('alice', 'Team notes')['name']);
        $before = $this->restStates();

        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$id, ['name' => 'Team handbook', 'color' => '#123456'])
            ->assertOk();

        $this->assertCollectionUpdated($this->restChanges('alice', $before['alice']), $before['alice'], $id, 'alice (REST)');
        $seen = $this->notebookNamed('alice', 'Team handbook');
        $this->assertSame($id, $seen['id']);
        $this->assertSame('#123456', $seen['color']);
    }

    /**
     * @return array{0: string, 1: string} the owner's and the sharee's notebook id
     */
    private function sharedNotebook(string $name): array
    {
        $ownerId = (string) $this->asUser('bob')
            ->postJson('/api/v1/notes/notebooks', ['name' => $name])
            ->assertCreated()
            ->json('id');
        $this->asUser('bob')
            ->patchJson('/api/v1/notes/notebooks/'.$ownerId, ['shareWith' => ['alice' => ['mayWriteAll' => true]]])
            ->assertOk();

        return [$ownerId, (string) $this->notebookNamed('alice', $name)['id']];
    }

    /** @return array{bob: string, alice: string} */
    private function restStates(): array
    {
        return [
            'bob' => (string) $this->restChanges('bob', null)['newState'],
            'alice' => (string) $this->restChanges('alice', null)['newState'],
        ];
    }

    /** @return array<string, mixed> */
    private function restChanges(string $username, ?string $since): array
    {
        $query = $since === null ? '' : '?since='.rawurlencode($since);

        return $this->asUser($username)->getJson('/api/v1/notes/notebooks/changes'.$query)->assertOk()->json();
    }

    private function jmapNotebookState(string $username): string
    {
        return (string) $this->jmapAs($username, [
            ['Notebook/get', ['accountId' => $username, 'ids' => []], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.state');
    }

    /** @return array<string, mixed> */
    private function jmapChanges(string $username, string $since): array
    {
        return $this->jmapAs($username, [
            ['Notebook/changes', ['accountId' => $username, 'sinceState' => $since], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');
    }

    /** @return array<string, mixed> */
    private function notebookNamed(string $username, string $name): array
    {
        $row = collect($this->asUser($username)->getJson('/api/v1/notes/notebooks')->assertOk()->json('list'))
            ->first(static fn (array $notebook): bool => ($notebook['name'] ?? '') === $name);
        $this->assertIsArray($row, $username.' must see notebook '.$name);

        return $row;
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::NOTES],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function principal(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }

    private function asUser(string $username): static
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

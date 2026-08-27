<?php

declare(strict_types=1);

namespace Tests\Feature\Tasks;

use App\Services\Tasks\InboxTaskListProvisioner;
use App\Support\WgwSettings;
use Tests\Support\CalDavCollectionSharingInterop;
use Tests\Support\TasksTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalDAV calendarserver-sharing ↔ REST shareWith interop for VTODO collections
 * (Task #650 / Chunk B). Shared cases live in {@see CalDavCollectionSharingInterop}.
 */
final class TasksCalDavSharingTest extends WgwDatabaseTestCase
{
    use CalDavCollectionSharingInterop;
    use TasksTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpTasksFixtures();
        $this->setAppSetting(WgwSettings::CALENDAR_ENABLED, true);
        $this->seedInboxTaskListFor('alice');
        $this->setUpCalDavSharingInterop();
    }

    protected function calDavSharingComponentSet(): string
    {
        return 'VTODO';
    }

    protected function optionsCollectionUri(string $username): string
    {
        return InboxTaskListProvisioner::URI;
    }

    protected function createSharingCollection(string $username, string $name, string $uri): string
    {
        return (string) $this->asUser($username)
            ->postJson('/api/v1/tasks/tasklists', [
                'name' => $name,
                'id' => $uri,
            ])
            ->assertCreated()
            ->json('id');
    }

    protected function shareCollectionViaApp(string $owner, string $collectionId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWriteAll' => true]
            : ['mayReadItems' => true];

        $this->asUser($owner)
            ->patchJson('/api/v1/tasks/tasklists/'.$collectionId, [
                'shareWith' => [$sharee => $rights],
            ])
            ->assertOk();
    }

    protected function revokeCollectionViaApp(string $owner, string $collectionId, string $sharee): void
    {
        $this->asUser($owner)
            ->patchJson('/api/v1/tasks/tasklists/'.$collectionId, [
                'shareWith' => [$sharee => null],
            ])
            ->assertOk();
    }

    protected function ownerCollectionShareWith(string $username, string $collectionId): ?array
    {
        $shareWith = $this->asUser($username)
            ->getJson('/api/v1/tasks/tasklists/'.$collectionId)
            ->assertOk()
            ->json('shareWith');

        return is_array($shareWith) ? $shareWith : null;
    }

    protected function collectionNamedForViewer(string $username, string $name): array
    {
        $list = $this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list');
        $row = collect($list)->first(static fn (array $item): bool => ($item['name'] ?? '') === $name);
        $this->assertIsArray($row, "Expected {$username} to see task list {$name}");

        return $row;
    }

    protected function collectionNamesForViewer(string $username): array
    {
        $list = $this->asUser($username)->getJson('/api/v1/tasks/tasklists')->assertOk()->json('list');

        return array_values(array_map(
            static fn (array $row): string => (string) $row['name'],
            $list,
        ));
    }

    protected function sharingObjectIcs(string $summary): string
    {
        return $this->sampleTodoIcs($summary);
    }

    private function asUser(string $username)
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }
}

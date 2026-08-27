<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\CalDavCollectionSharingInterop;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * CalDAV calendarserver-sharing ↔ JMAP shareWith interop for VEVENT collections
 * (Task #606 / Chunk D). Shared cases live in {@see CalDavCollectionSharingInterop}.
 */
final class CalendarsCalDavSharingTest extends WgwDatabaseTestCase
{
    use CalDavCollectionSharingInterop;
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        $this->seedDefaultCalendarFor('alice');
        $this->setUpCalDavSharingInterop();
    }

    protected function calDavSharingComponentSet(): string
    {
        return 'VEVENT';
    }

    protected function optionsCollectionUri(string $username): string
    {
        return 'default';
    }

    protected function createSharingCollection(string $username, string $name, string $uri): string
    {
        $created = $this->jmapAs($username, [
            ['Calendar/set', ['accountId' => $username, 'create' => ['c' => [
                'name' => $name,
                'id' => $uri,
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.created.c');

        return (string) $created['id'];
    }

    protected function shareCollectionViaApp(string $owner, string $collectionId, string $sharee, bool $write): void
    {
        $rights = $write
            ? ['mayWriteAll' => true]
            : ['mayReadItems' => true];

        $args = $this->jmapAs($owner, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$collectionId => [
                'shareWith' => [$sharee => $rights],
            ]]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1');

        $this->assertNull($args['notUpdated'][$collectionId] ?? null);
    }

    protected function revokeCollectionViaApp(string $owner, string $collectionId, string $sharee): void
    {
        $this->jmapAs($owner, [
            ['Calendar/set', ['accountId' => $owner, 'update' => [$collectionId => [
                'shareWith' => [$sharee => null],
            ]]], 'c0'],
        ])->assertOk();
    }

    protected function ownerCollectionShareWith(string $username, string $collectionId): ?array
    {
        $shareWith = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => [$collectionId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0.shareWith');

        return is_array($shareWith) ? $shareWith : null;
    }

    protected function collectionNamedForViewer(string $username, string $name): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        $calendar = collect($list)->first(static fn (array $row): bool => $row['name'] === $name);
        $this->assertIsArray($calendar, "Expected {$username} to see calendar {$name}");

        return $calendar;
    }

    protected function collectionNamesForViewer(string $username): array
    {
        $list = $this->jmapAs($username, [
            ['Calendar/get', ['accountId' => $username, 'ids' => null], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list');

        return array_values(array_map(
            static fn (array $row): string => (string) $row['name'],
            $list,
        ));
    }

    protected function sharingObjectIcs(string $summary): string
    {
        return $this->sampleIcs($summary);
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }
}

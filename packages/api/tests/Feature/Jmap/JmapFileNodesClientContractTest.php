<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Files envelope lifecycle contract (#450), modeled on the other domains'
 * contract tests: connect → initial sync → batched query+get via a
 * ResultReference → writes → incremental sync — plus a second FileNode/set
 * write surfacing in /changes and the mixed-domain no-state-bleed case.
 */
final class JmapFileNodesClientContractTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     * @param  list<string>|null  $using
     */
    private function jmap(array $methodCalls, ?array $using = null): TestResponse
    {
        return $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => $using ?? [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    public function test_full_files_client_lifecycle_stays_on_the_incremental_path(): void
    {
        // connect(): the session advertises the filenode capability.
        $session = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/jmap/session')
            ->assertOk()
            ->json();
        $accountId = $session['primaryAccounts'][JmapCapabilities::FILENODE];
        $this->assertSame('bob', $accountId);

        // Initial sync: the visible tree plus the account-wide state.
        $initial = $this->jmap([
            ['FileNode/get', ['accountId' => $accountId, 'ids' => null], 'c0'],
        ])->assertOk();
        $stateS0 = $initial->json('methodResponses.0.1.state');
        $roots = array_values(array_filter(
            $initial->json('methodResponses.0.1.list'),
            static fn (array $n): bool => $n['parentId'] === null && $n['name'] === 'bob',
        ));
        $homeId = $roots[0]['id'];

        // Write: upload a blob, create a folder + file inside it.
        $blobId = (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/bob',
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->userBearerToken(),
                'Content-Type' => 'text/markdown',
            ]),
            content: '# hello',
        )->json('blobId');

        $create = $this->jmap([
            ['FileNode/set', ['accountId' => $accountId, 'create' => [
                'd0' => ['parentId' => $homeId, 'name' => 'Docs'],
                'f0' => ['parentId' => '#d0', 'name' => 'readme.md', 'blobId' => $blobId],
            ]], 'c1'],
        ])->assertOk();
        // Creation references inside one call are not ResultReferences; the
        // draft relies on ordered processing — our set applies creates in
        // order, so '#d0' as parentId is NOT supported. Assert the honest
        // rejection, then create sequentially like a real client would.
        $this->assertNotNull($create->json('methodResponses.0.1.created.d0'));
        $this->assertSame('invalidProperties', $create->json('methodResponses.0.1.notCreated.f0.type'));
        $dirId = $create->json('methodResponses.0.1.created.d0.id');

        $createFile = $this->jmap([
            ['FileNode/set', ['accountId' => $accountId, 'create' => [
                'f1' => ['parentId' => $dirId, 'name' => 'readme.md', 'blobId' => $blobId],
            ]], 'c2'],
        ])->assertOk();
        $fileId = $createFile->json('methodResponses.0.1.created.f1.id');
        $this->assertIsString($fileId);

        // Incremental sync after the writes.
        $changes = $this->jmap([
            ['FileNode/changes', ['accountId' => $accountId, 'sinceState' => $stateS0], 'c3'],
        ])->assertOk();
        $changes->assertJsonPath('methodResponses.0.0', 'FileNode/changes');
        $this->assertEqualsCanonicalizing([$dirId, $fileId], $changes->json('methodResponses.0.1.created'));
        $stateS1 = $changes->json('methodResponses.0.1.newState');

        // Batched query → get wired with the "#ids" ResultReference.
        $batch = $this->jmap([
            ['FileNode/query', ['accountId' => $accountId, 'filter' => ['parentId' => $dirId]], 'c4'],
            ['FileNode/get', [
                'accountId' => $accountId,
                '#ids' => ['resultOf' => 'c4', 'name' => 'FileNode/query', 'path' => '/ids'],
            ], 'c5'],
        ])->assertOk();
        $this->assertSame([$fileId], $batch->json('methodResponses.0.1.ids'));
        $this->assertSame('readme.md', $batch->json('methodResponses.1.1.list.0.name'));

        // A second FileNode/set write still surfaces in /changes.
        $extra = $this->jmap([
            ['FileNode/set', ['accountId' => $accountId, 'create' => [
                'd1' => ['parentId' => $homeId, 'name' => 'FromSet'],
            ]], 'c6'],
        ])->assertOk();
        $extraId = $extra->json('methodResponses.0.1.created.d1.id');
        $afterSet = $this->jmap([
            ['FileNode/changes', ['accountId' => $accountId, 'sinceState' => $stateS1], 'c7'],
        ])->assertOk();
        $this->assertContains($extraId, $afterSet->json('methodResponses.0.1.created'));
        $stateS2 = $afterSet->json('methodResponses.0.1.newState');

        // Destroy, then sync incrementally from S2.
        $this->jmap([
            ['FileNode/set', ['accountId' => $accountId, 'destroy' => [$fileId]], 'c8'],
        ])->assertOk();
        $afterDestroy = $this->jmap([
            ['FileNode/changes', ['accountId' => $accountId, 'sinceState' => $stateS2], 'c9'],
        ])->assertOk();
        $this->assertContains($fileId, $afterDestroy->json('methodResponses.0.1.destroyed'));
    }

    public function test_mixed_domain_batch_keeps_states_independent(): void
    {
        $this->seedPrivateFile('bob', 'mixed.txt');

        $response = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
            ['Core/echo', ['ping' => true], 'c1'],
        ], [JmapCapabilities::CORE, JmapCapabilities::FILENODE, JmapCapabilities::CALENDARS])->assertOk();

        // The filenode state is a bare sequence number — never the
        // count-prefixed codec form the Sabre domains use.
        $state = $response->json('methodResponses.0.1.state');
        $this->assertMatchesRegularExpression('/^\d+$/', $state);

        // A filenode method without its capability in `using` is unknown.
        $without = $this->jmap([
            ['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c0'],
        ], [JmapCapabilities::CORE, JmapCapabilities::CALENDARS])->assertOk();
        $without->assertJsonPath('methodResponses.0.0', 'error');
        $without->assertJsonPath('methodResponses.0.1.type', 'unknownMethod');
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\JmapFileNode;
use App\Services\Jmap\FileNodes\FileNodeSetError;
use App\Services\Jmap\FileNodes\FileNodeVersionCheck;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Per-file version check (#1500): `expectedBlobId` on a FileNode/set
 * update, gated per request on the version-check capability, failing one
 * update with `versionMismatch` (and nothing overwritten) when the node
 * changed — always for a hash-pending node.
 */
final class JmapFileNodeVersionCheckTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
        $this->token = $this->userBearerToken();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     */
    private function jmap(array $calls, bool $versionCheck = true): TestResponse
    {
        $using = [JmapCapabilities::CORE, JmapCapabilities::FILENODE];
        if ($versionCheck) {
            $using[] = JmapCapabilities::FILENODE_VERSION_CHECK;
        }

        return $this->withBearer($this->token)->postJson('/api/v1/jmap', ['using' => $using, 'methodCalls' => $calls])->assertOk();
    }

    /**
     * @return array<string, array<string, mixed>>
     */
    private function nodes(): array
    {
        return collect($this->jmap([['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'g']])->json('methodResponses.0.1.list'))
            ->keyBy('name')->all();
    }

    private function upload(string $bytes): string
    {
        return (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->token,
            'Content-Type' => 'text/plain',
        ]), content: $bytes)->assertStatus(201)->json('blobId');
    }

    /**
     * @param  array<string, mixed>  $update
     * @return array<string, mixed>
     */
    private function update(array $update, bool $versionCheck = true): array
    {
        return (array) $this->jmap([['FileNode/set', ['accountId' => 'bob', 'update' => $update], 's']], $versionCheck)->json('methodResponses.0.1');
    }

    private function contents(string $name): string
    {
        return (string) app(WgwStorage::class)->files()->get('users/bob/'.$name);
    }

    public function test_session_advertises_the_capability(): void
    {
        $session = $this->withBearer($this->token)->getJson('/api/v1/jmap/session')->assertOk()->json();

        $this->assertSame([], $session['capabilities'][JmapCapabilities::FILENODE_VERSION_CHECK]);
        $this->assertSame([], $session['accounts']['bob']['accountCapabilities'][JmapCapabilities::FILENODE_VERSION_CHECK]);
    }

    public function test_a_matching_expected_blob_id_replaces_the_content_and_keeps_the_node(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $node = $this->nodes()['plan.txt'];

        $result = $this->update([$node['id'] => ['blobId' => $this->upload('version two'), 'expectedBlobId' => $node['blobId']]]);

        $this->assertEmpty($result['notUpdated']);
        $this->assertSame('version two', $this->contents('plan.txt'));
        $this->assertSame($node['id'], $this->nodes()['plan.txt']['id']);
    }

    public function test_a_stale_expected_blob_id_is_version_mismatch_and_nothing_is_overwritten(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $this->seedPrivateFile('bob', 'other.txt', 'other one');
        $nodes = $this->nodes();
        $stale = $nodes['plan.txt']['blobId'];
        // Another device changed the file in the meantime.
        $this->update([$nodes['plan.txt']['id'] => ['blobId' => $this->upload('changed elsewhere')]]);
        $current = $this->nodes()['plan.txt']['blobId'];

        $result = $this->update([
            $nodes['plan.txt']['id'] => ['blobId' => $this->upload('my edit'), 'expectedBlobId' => $stale],
            $nodes['other.txt']['id'] => ['blobId' => $this->upload('other two'), 'expectedBlobId' => $nodes['other.txt']['blobId']],
        ]);

        $error = $result['notUpdated'][$nodes['plan.txt']['id']];
        $this->assertSame('versionMismatch', $error['type']);
        $this->assertSame($nodes['plan.txt']['id'], $error['existingId']);
        $this->assertSame($current, $error['existingBlobId']);
        $this->assertSame('changed elsewhere', $this->contents('plan.txt'));
        // The rest of the request still applies.
        $this->assertArrayHasKey($nodes['other.txt']['id'], $result['updated']);
        $this->assertSame('other two', $this->contents('other.txt'));
    }

    public function test_an_expected_blob_id_of_another_length_is_version_mismatch_for_that_update_only(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $nodes = $this->nodes();

        $result = $this->update([$nodes['plan.txt']['id'] => ['blobId' => $this->upload('my edit'), 'expectedBlobId' => 'jb-short']]);

        $this->assertSame('versionMismatch', $result['notUpdated'][$nodes['plan.txt']['id']]['type']);
        $this->assertSame('version one', $this->contents('plan.txt'));
    }

    public function test_only_one_of_two_writers_holding_the_same_version_wins_the_claim(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $this->nodes();
        $loaded = JmapFileNode::query()->where('storage_key', 'users/bob/plan.txt')->firstOrFail();
        $second = JmapFileNode::query()->where('storage_key', 'users/bob/plan.txt')->firstOrFail();
        $check = app(FileNodeVersionCheck::class);

        $check->claim($loaded);

        try {
            $check->claim($second);
            $this->fail('The second writer must lose the claim.');
        } catch (FileNodeSetError $e) {
            $this->assertSame('versionMismatch', $e->shape['type']);
        }
    }

    public function test_a_mismatch_leaves_a_rename_in_the_same_update_undone(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $node = $this->nodes()['plan.txt'];

        $result = $this->update([$node['id'] => ['name' => 'renamed.txt', 'expectedBlobId' => 'fnb-'.substr((string) $node['id'], 0).'-00000000']]);

        $this->assertSame('versionMismatch', $result['notUpdated'][$node['id']]['type']);
        $this->assertArrayHasKey('plan.txt', $this->nodes());
    }

    public function test_without_the_property_behaviour_is_unchanged(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $node = $this->nodes()['plan.txt'];

        $this->update([$node['id'] => ['blobId' => $this->upload('plain overwrite')]], versionCheck: false);

        $this->assertSame('plain overwrite', $this->contents('plan.txt'));
    }

    public function test_the_property_without_the_capability_is_invalid_properties_and_the_file_is_unchanged(): void
    {
        $this->seedPrivateFile('bob', 'plan.txt', 'version one');
        $node = $this->nodes()['plan.txt'];

        $result = $this->update([$node['id'] => ['blobId' => $this->upload('should not land'), 'expectedBlobId' => $node['blobId']]], versionCheck: false);

        $error = $result['notUpdated'][$node['id']];
        $this->assertSame('invalidProperties', $error['type']);
        $this->assertSame(['expectedBlobId'], $error['properties']);
        $this->assertSame('version one', $this->contents('plan.txt'));
    }

    public function test_a_hash_pending_node_always_mismatches(): void
    {
        config(['wgw.jmap.discovery_hash_max_bytes' => 10]);
        $this->seedPrivateFile('bob', 'restored.bin', str_repeat('r', 500));
        $node = $this->nodes()['restored.bin'];
        $this->assertTrue($node['contentHashPending']);

        // Even the node's current (provisional) id is refused.
        $result = $this->update([$node['id'] => ['blobId' => $this->upload('replace attempt'), 'expectedBlobId' => $node['blobId']]]);

        $this->assertSame('versionMismatch', $result['notUpdated'][$node['id']]['type']);
        $this->assertSame($node['blobId'], $result['notUpdated'][$node['id']]['existingBlobId']);
        $this->assertSame(str_repeat('r', 500), $this->contents('restored.bin'));
    }
}

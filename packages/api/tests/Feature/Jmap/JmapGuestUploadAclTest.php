<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Models\DriveShare;
use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithGuestUploads;
use Tests\Support\WgwDatabaseTestCase;

/**
 * What a guest may not do on the upload path (#1715): no upload on a view
 * link, nothing after the link is revoked, lowered, or its password changed,
 * nothing outside the shared folder, nobody else's blobs, no deletes,
 * renames, folders, or blind overwrites, and no methods beyond the upload.
 */
final class JmapGuestUploadAclTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithGuestUploads;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
        $this->createDriveDirectory('/users/bob', 'inbox');
        $this->createDriveDirectory('/users/bob', 'private');
        app(WgwStorage::class)->files()->put('users/bob/inbox/existing.txt', 'owner bytes');
        app(WgwStorage::class)->files()->put('users/bob/private/secret.txt', 'secret');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_view_link_cannot_open_the_upload_path(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink('view')['token']);

        $this->withBearer($guest)->getJson('/api/v1/jmap/session')
            ->assertForbidden()->assertJsonPath('code', 'guest_upload_forbidden');
        $this->guestJmap($guest, [['Core/echo', [], 'c']])
            ->assertForbidden()->assertJsonPath('code', 'guest_upload_forbidden');
        $this->guestUpload($guest, 'guest-'.str_repeat('0', 32), 'bytes')
            ->assertForbidden()->assertJsonPath('code', 'guest_upload_forbidden');
    }

    public function test_guests_and_members_keep_to_their_own_jmap_routes(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);

        $this->withBearer($guest)->postJson('/api/v1/jmap', ['using' => [JmapCapabilities::CORE], 'methodCalls' => []])
            ->assertForbidden();
        $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$guest, 'Content-Type' => 'application/octet-stream',
        ]), content: 'x')->assertForbidden();
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap/guest', ['using' => [JmapCapabilities::CORE], 'methodCalls' => []])
            ->assertForbidden();
    }

    public function test_an_upload_stops_when_the_owner_revokes_the_link_mid_upload(): void
    {
        $link = $this->createGuestLink();
        $guest = $this->openGuestSession($link['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $rootId = $this->guestRootNodeId($guest, $accountId);
        $created = $this->guestMethod($guest, $accountId, 'BlobAssembly/set', ['create' => ['a' => ['size' => 8]]]);
        $assemblyId = (string) $created['created']['a']['id'];
        $first = (string) $this->guestUpload($guest, $accountId, 'abcd', ['Wgw-Assembly-Id' => $assemblyId])->assertCreated()->json('blobId');

        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/files/shares/'.$link['id'])->assertSuccessful();

        $this->guestUpload($guest, $accountId, 'efgh', ['Wgw-Assembly-Id' => $assemblyId])->assertForbidden();
        $this->guestJmap($guest, [['BlobAssembly/append', ['accountId' => $accountId, 'id' => $assemblyId, 'parts' => [['index' => 0, 'blobId' => $first]]], 'c']])
            ->assertForbidden();
        $this->guestJmap($guest, [['FileNode/set', ['accountId' => $accountId, 'create' => ['f' => ['parentId' => $rootId, 'name' => 'late.txt', 'blobId' => $first]]], 'c']])
            ->assertForbidden();
        $this->assertFalse(app(WgwStorage::class)->files()->fileExists('users/bob/inbox/late.txt'));
    }

    /**
     * @return iterable<string, array{0: array<string, mixed>}>
     */
    public static function linkChangeProvider(): iterable
    {
        yield 'lowered to view' => [['defaultAccess' => 'view']];
        yield 'password changed' => [['password' => 'new-secret']];
        yield 'expired' => [['expiresAt' => '2000-01-01T00:00:00Z']];
    }

    /**
     * @param  array<string, mixed>  $change
     */
    #[DataProvider('linkChangeProvider')]
    public function test_the_next_request_is_refused_after_the_link_changes(array $change): void
    {
        $link = $this->createGuestLink();
        $guest = $this->openGuestSession($link['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $this->guestUpload($guest, $accountId, 'before')->assertCreated();

        $owner = $this->withBearer($this->userBearerToken());
        $updatedAt = $owner->getJson('/api/v1/files/shares/'.$link['id'])->assertOk()->json('data.updatedAt');
        $owner->patchJson('/api/v1/files/shares/'.$link['id'], $change + ['updatedAt' => $updatedAt])->assertOk();

        $this->guestUpload($guest, $accountId, 'after')->assertForbidden();
        $this->withBearer($guest)->getJson('/api/v1/jmap/session')->assertForbidden();
    }

    public function test_a_guest_cannot_reach_outside_the_shared_folder(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $ownerNodes = $this->withBearer($this->userBearerToken())->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => [['FileNode/query', ['accountId' => 'bob', 'filter' => ['name' => 'private']], 'q']],
        ])->assertOk()->json('methodResponses.0.1.ids');
        $privateId = (string) $ownerNodes[0];

        $get = $this->guestMethod($guest, $accountId, 'FileNode/get', ['ids' => [$privateId]]);
        $this->assertSame([$privateId], $get['notFound']);
        $blob = (string) $this->guestUpload($guest, $accountId, 'escape')->assertCreated()->json('blobId');
        $created = $this->guestCreateFile($guest, $accountId, $privateId, 'escape.txt', $blob);
        $this->assertSame('invalidProperties', $created['notCreated']['f']['type'] ?? null);

        $rootId = $this->guestRootNodeId($guest, $accountId);
        foreach (['../private/escape.txt', '..', 'a/b.txt', "nul\0.txt"] as $name) {
            $result = $this->guestCreateFile($guest, $accountId, $rootId, $name, $blob);
            $this->assertSame('invalidProperties', $result['notCreated']['f']['type'] ?? null, $name);
        }
        $this->assertFalse(app(WgwStorage::class)->files()->fileExists('users/bob/private/escape.txt'));
        $this->assertSame('secret', app(WgwStorage::class)->files()->get('users/bob/private/secret.txt'));
    }

    public function test_a_guest_cannot_attach_the_owners_blobs(): void
    {
        $ownerBlob = (string) $this->call('POST', '/api/v1/jmap/upload/bob', server: $this->transformHeadersToServerVars([
            'Authorization' => 'Bearer '.$this->userBearerToken(), 'Content-Type' => 'application/octet-stream',
        ]), content: 'owner only')->assertCreated()->json('blobId');
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];

        $result = $this->guestCreateFile($guest, $accountId, $this->guestRootNodeId($guest, $accountId), 'copy.txt', $ownerBlob);

        $this->assertSame('invalidProperties', $result['notCreated']['f']['type'] ?? null, json_encode($result) ?: '');
        $this->assertSame(['blobId'], $result['notCreated']['f']['properties'] ?? null);
    }

    public function test_two_guests_of_one_link_do_not_share_blobs(): void
    {
        $link = $this->createGuestLink();
        $first = $this->openGuestSession($link['token']);
        $second = $this->openGuestSession($link['token']);
        $firstAccount = $this->guestJmapSession($first)['accountId'];
        $secondAccount = $this->guestJmapSession($second)['accountId'];
        $this->assertNotSame($firstAccount, $secondAccount);
        $blob = (string) $this->guestUpload($first, $firstAccount, 'first guest')->assertCreated()->json('blobId');

        $result = $this->guestCreateFile($second, $secondAccount, $this->guestRootNodeId($second, $secondAccount), 'taken.txt', $blob);

        $this->assertSame('invalidProperties', $result['notCreated']['f']['type'] ?? null);
        $this->guestUpload($second, $firstAccount, 'other account')->assertNotFound();
    }

    public function test_guests_cannot_delete_rename_make_folders_or_overwrite_blind(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $rootId = $this->guestRootNodeId($guest, $accountId);
        $existing = $this->guestMethod($guest, $accountId, 'FileNode/query', ['filter' => ['parentId' => $rootId, 'name' => 'existing.txt']]);
        $fileId = (string) $existing['ids'][0];
        $blob = (string) $this->guestUpload($guest, $accountId, 'guest bytes')->assertCreated()->json('blobId');

        $result = $this->guestMethod($guest, $accountId, 'FileNode/set', [
            'create' => [
                'dir' => ['parentId' => $rootId, 'name' => 'folder'],
                'typedDir' => ['parentId' => $rootId, 'name' => 'folder2', 'nodeType' => 'directory'],
            ],
            'update' => [
                $fileId => ['name' => 'renamed.txt'],
                $rootId => ['blobId' => $blob],
            ],
            'destroy' => [$fileId],
        ]);

        $this->assertSame('forbidden', $result['notCreated']['dir']['type'] ?? null);
        $this->assertSame('forbidden', $result['notCreated']['typedDir']['type'] ?? null);
        $this->assertSame('forbidden', $result['notUpdated'][$fileId]['type'] ?? null);
        $this->assertSame('forbidden', $result['notUpdated'][$rootId]['type'] ?? null);
        $this->assertSame('forbidden', $result['notDestroyed'][$fileId]['type'] ?? null);
        $this->assertSame([], $result['destroyed']);
        $disk = app(WgwStorage::class)->files();
        $this->assertSame('owner bytes', $disk->get('users/bob/inbox/existing.txt'));
        $this->assertFalse($disk->directoryExists('users/bob/inbox/folder'));

        $replace = $this->guestJmap($guest, [['FileNode/set', [
            'accountId' => $accountId,
            'onExists' => 'replace',
            'create' => ['f' => ['parentId' => $rootId, 'name' => 'existing.txt', 'blobId' => $blob]],
        ], 'c']])->assertOk();
        $this->assertSame('error', $replace->json('methodResponses.0.0'));
        $this->assertSame('owner bytes', $disk->get('users/bob/inbox/existing.txt'));
    }

    public function test_a_legacy_full_link_still_gives_guests_no_structure_changes(): void
    {
        $link = $this->createGuestLink();
        DriveShare::query()->whereKey($link['id'])->update(['default_access' => 'full']);
        $guest = $this->openGuestSession($link['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $rootId = $this->guestRootNodeId($guest, $accountId);
        $fileId = (string) $this->guestMethod($guest, $accountId, 'FileNode/query', ['filter' => ['parentId' => $rootId, 'name' => 'existing.txt']])['ids'][0];
        $this->assertTrue($this->guestMethod($guest, $accountId, 'FileNode/get', ['ids' => [$fileId]])['list'][0]['myRights']['mayDelete']);

        $result = $this->guestMethod($guest, $accountId, 'FileNode/set', [
            'create' => ['dir' => ['parentId' => $rootId, 'name' => 'folder', 'nodeType' => 'directory']],
            'update' => [$fileId => ['name' => 'renamed.txt']],
            'destroy' => [$fileId],
        ]);

        $this->assertSame('forbidden', $result['notCreated']['dir']['type'] ?? null);
        $this->assertSame('forbidden', $result['notUpdated'][$fileId]['type'] ?? null);
        $this->assertSame('forbidden', $result['notDestroyed'][$fileId]['type'] ?? null);
        $disk = app(WgwStorage::class)->files();
        $this->assertSame('owner bytes', $disk->get('users/bob/inbox/existing.txt'));
        $this->assertFalse($disk->directoryExists('users/bob/inbox/folder'));
    }

    public function test_only_the_upload_methods_and_capabilities_are_there(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];

        foreach ([JmapCapabilities::QUOTA, JmapCapabilities::BLOB, JmapCapabilities::CONTACTS, JmapCapabilities::NOTES] as $urn) {
            $this->guestJmap($guest, [['Core/echo', [], 'c']], [JmapCapabilities::CORE, $urn])
                ->assertStatus(400)
                ->assertJsonPath('type', 'urn:ietf:params:jmap:error:unknownCapability');
        }
        foreach (['FileNode/changes', 'FileNode/copy', 'FileNode/queryChanges', 'Quota/get', 'Blob/upload', 'Blob/get'] as $method) {
            $response = $this->guestJmap($guest, [[$method, ['accountId' => $accountId], 'c']])->assertOk();
            $this->assertSame('error', $response->json('methodResponses.0.0'), $method);
            $this->assertSame('unknownMethod', $response->json('methodResponses.0.1.type'), $method);
        }
        foreach ([
            ['FileNode/get', ['ids' => null]],
            ['FileNode/query', []],
            ['FileNode/query', ['filter' => ['name' => 'existing.txt']]],
            ['FileNode/query', ['filter' => ['ancestorId' => $this->guestRootNodeId($guest, $accountId)]]],
            ['FileNode/query', ['filter' => ['parentId' => $this->guestRootNodeId($guest, $accountId)], 'depth' => 5]],
            ['FileNode/query', ['filter' => ['operator' => 'OR', 'conditions' => [['isTopLevel' => true]]]]],
        ] as [$method, $args]) {
            $response = $this->guestJmap($guest, [[$method, ['accountId' => $accountId] + $args, 'c']])->assertOk();
            $this->assertSame('invalidArguments', $response->json('methodResponses.0.1.type'), $method.' '.json_encode($args));
        }
        $other = $this->guestJmap($guest, [['FileNode/get', ['accountId' => 'bob', 'ids' => null], 'c']])->assertOk();
        $this->assertSame('accountNotFound', $other->json('methodResponses.0.1.type'));
    }
}

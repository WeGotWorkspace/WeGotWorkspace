<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Jmap\JmapCapabilities;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Tests\Support\DriveTestFixtures;
use Tests\Support\InteractsWithGuestUploads;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A guest on an `edit` link to a folder uploads through the same JMAP path
 * as members (#1715): its own Session and account, a single part or parts
 * plus assembly, then FileNode/set into the share; the bytes and hash land
 * as sent, and a replace needs the version the guest saw.
 */
final class JmapGuestUploadTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;
    use InteractsWithGuestUploads;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        config(['wgw.jmap.maintenance_share' => 0]);
        $this->createDriveDirectory('/users/bob', 'inbox');
        $this->createDriveDirectory(self::GUEST_SHARE_ROOT, 'sub');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_the_guest_session_has_one_upload_account_and_no_other_capability(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);

        $session = $this->withBearer($guest)->getJson('/api/v1/jmap/session')->assertOk();

        $accounts = (array) $session->json('accounts');
        $this->assertCount(1, $accounts);
        $accountId = (string) array_key_first($accounts);
        $this->assertMatchesRegularExpression('/^guest-[0-9a-f]{32}$/', $accountId);
        $this->assertSame('inbox', $session->json('accounts.'.$accountId.'.name'));
        $this->assertStringEndsWith('/api/v1/jmap/guest', (string) $session->json('apiUrl'));
        $this->assertStringEndsWith('/api/v1/jmap/guest/upload/{accountId}', (string) $session->json('uploadUrl'));
        $capabilities = array_keys((array) $session->json('capabilities'));
        sort($capabilities);
        $expected = self::GUEST_USING;
        sort($expected);
        $this->assertSame($expected, $capabilities);
        $this->assertStringStartsWith('share:', (string) $session->json('username'));
    }

    public function test_a_member_session_is_unchanged(): void
    {
        $session = $this->withBearer($this->userBearerToken())->getJson('/api/v1/jmap/session')->assertOk();

        $this->assertSame(['bob'], array_keys((array) $session->json('accounts')));
        $this->assertArrayHasKey(JmapCapabilities::QUOTA, (array) $session->json('capabilities'));
        $this->assertStringEndsWith('/api/v1/jmap', (string) $session->json('apiUrl'));
    }

    public function test_the_guest_sees_only_the_shared_folder(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];

        $rootId = $this->guestRootNodeId($guest, $accountId);
        $get = $this->guestMethod($guest, $accountId, 'FileNode/get', ['ids' => [$rootId]]);

        $root = $get['list'][0];
        $this->assertSame('inbox', $root['name']);
        $this->assertTrue($root['myRights']['mayAddChildren']);
        $this->assertTrue($root['myRights']['mayModifyContent']);
        $this->assertFalse($root['myRights']['mayRename']);
        $this->assertFalse($root['myRights']['mayDelete']);
    }

    public function test_a_guest_uploads_a_small_file_into_the_shared_folder(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $bytes = random_bytes(4096);

        $part = $this->guestUpload($guest, $accountId, $bytes, ['Wgw-Part-Sha256' => hash('sha256', $bytes)])
            ->assertCreated()
            ->assertJsonPath('accountId', $accountId);
        $result = $this->guestCreateFile($guest, $accountId, $this->guestRootNodeId($guest, $accountId), 'delivery.bin', (string) $part->json('blobId'));

        $this->assertArrayHasKey('f', $result['created'], json_encode($result) ?: '');
        $disk = app(WgwStorage::class)->files();
        $this->assertSame($bytes, $disk->get('users/bob/inbox/delivery.bin'));
        $this->assertSame(hash('sha256', $bytes), $this->contentSha256('users/bob/inbox/delivery.bin'));
    }

    public function test_a_guest_uploads_a_large_file_in_parts_into_a_subfolder(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $bytes = random_bytes(3 * 65536 + 123);
        $parts = str_split($bytes, 65536);

        $created = $this->guestMethod($guest, $accountId, 'BlobAssembly/set', ['create' => ['a' => ['size' => strlen($bytes)]]]);
        $assemblyId = (string) $created['created']['a']['id'];
        $refs = [];
        foreach ($parts as $index => $part) {
            $blobId = (string) $this->guestUpload($guest, $accountId, $part, [
                'Wgw-Part-Length' => (string) strlen($part),
                'Wgw-Part-Sha256' => hash('sha256', $part),
                'Wgw-Assembly-Id' => $assemblyId,
            ])->assertCreated()->json('blobId');
            $refs[] = ['index' => $index, 'blobId' => $blobId];
        }
        $append = $this->guestMethod($guest, $accountId, 'BlobAssembly/append', ['id' => $assemblyId, 'parts' => $refs]);
        $this->assertSame('BlobAssembly/append', $append['_name'], json_encode($append) ?: '');
        $finish = $this->guestMethod($guest, $accountId, 'BlobAssembly/finish', ['id' => $assemblyId]);
        $this->assertIsString($finish['blobId'] ?? null, json_encode($finish) ?: '');

        $rootId = $this->guestRootNodeId($guest, $accountId);
        $children = $this->guestMethod($guest, $accountId, 'FileNode/query', ['filter' => ['parentId' => $rootId, 'name' => 'sub']]);
        $result = $this->guestCreateFile($guest, $accountId, (string) $children['ids'][0], 'video.bin', (string) $finish['blobId']);

        $this->assertArrayHasKey('f', $result['created'], json_encode($result) ?: '');
        $this->assertSame(hash('sha256', $bytes), hash('sha256', (string) app(WgwStorage::class)->files()->get('users/bob/inbox/sub/video.bin')));
        $this->assertSame(hash('sha256', $bytes), $this->contentSha256('users/bob/inbox/sub/video.bin'));
    }

    public function test_a_guest_replaces_a_file_only_with_the_version_it_saw(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $rootId = $this->guestRootNodeId($guest, $accountId);
        $first = (string) $this->guestUpload($guest, $accountId, 'first')->assertCreated()->json('blobId');
        $created = $this->guestCreateFile($guest, $accountId, $rootId, 'report.txt', $first);
        $nodeId = (string) $created['created']['f']['id'];
        $seen = (string) $this->guestMethod($guest, $accountId, 'FileNode/get', ['ids' => [$nodeId]])['list'][0]['blobId'];

        $second = (string) $this->guestUpload($guest, $accountId, 'second')->assertCreated()->json('blobId');
        $stale = $this->guestMethod($guest, $accountId, 'FileNode/set', [
            'update' => [$nodeId => ['blobId' => $second, 'expectedBlobId' => 'fnb-stale']],
        ]);
        $this->assertSame('versionMismatch', $stale['notUpdated'][$nodeId]['type'] ?? null, json_encode($stale) ?: '');

        $replaced = $this->guestMethod($guest, $accountId, 'FileNode/set', [
            'update' => [$nodeId => ['blobId' => $second, 'expectedBlobId' => $seen]],
        ]);
        $this->assertArrayHasKey($nodeId, $replaced['updated'], json_encode($replaced) ?: '');
        $this->assertSame('second', app(WgwStorage::class)->files()->get('users/bob/inbox/report.txt'));
    }

    public function test_a_taken_name_is_refused_so_the_client_picks_the_next_free_one(): void
    {
        $guest = $this->openGuestSession($this->createGuestLink()['token']);
        $accountId = $this->guestJmapSession($guest)['accountId'];
        $rootId = $this->guestRootNodeId($guest, $accountId);
        $blob = (string) $this->guestUpload($guest, $accountId, 'one')->assertCreated()->json('blobId');
        $this->guestCreateFile($guest, $accountId, $rootId, 'a.txt', $blob);

        $again = (string) $this->guestUpload($guest, $accountId, 'two')->assertCreated()->json('blobId');
        $result = $this->guestCreateFile($guest, $accountId, $rootId, 'a.txt', $again);

        $this->assertSame('alreadyExists', $result['notCreated']['f']['type'] ?? null, json_encode($result) ?: '');
        $this->assertSame('one', app(WgwStorage::class)->files()->get('users/bob/inbox/a.txt'));
    }

    private function contentSha256(string $key): ?string
    {
        $value = DB::connection('wgw')->table('jmap_file_nodes')
            ->where('storage_key', $key)->whereNull('deleted_at')->value('content_sha256');

        return is_string($value) ? $value : null;
    }
}

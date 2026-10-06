<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\Principal;
use App\Services\Admin\AdminConstants;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * Named-file WebDAV matrix for user and group trees (#781).
 *
 * Each cell uses {@see self::call()} so Sabre {@code initialize()} /
 * {@code calculateUri()} run. Plugin constructors with {@code $server === null}
 * are not this coverage.
 *
 * Group GET opens a named file under {@code /files/groups/{group}/}. That path
 * fatals before #758 un-finaled {@see FlysystemFile}. #1119 is the tripwire
 * for extend-final; this file asserts HTTP success only.
 *
 * Non-member PROPFIND/GET on the group folder is HTTP proof that listing
 * and open stay denied together (#1120). The parent hides the group (404),
 * matching {@see DavCrossUserAclTest} on group files.
 */
final class DavNamedFileHttpMatrixTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');

        $installRoot = sys_get_temp_dir().'/wgw-dav-matrix-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/alice', 0775, true);
        mkdir($this->dataDir.'/files/groups/team', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);
        unset($_COOKIE['sabre_ui_auth']);

        Principal::query()->firstOrCreate(
            ['uri' => AdminConstants::GROUP_CONTAINER_URI],
            ['displayname' => 'Groups', 'email' => null],
        );
        $team = $this->seedWgwGroup('principals/groups/team', 'Team');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($team, $alice);
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: string, 3: string, 4: string}>
     */
    public static function trees(): iterable
    {
        yield 'users' => [
            '/files/users/alice',
            '/files/users/alice/matrix.txt',
            '/files/users/alice/matrix-moved.txt',
            'users/alice/matrix.txt',
            'users/alice/matrix-moved.txt',
        ];
        yield 'groups' => [
            '/files/groups/team',
            '/files/groups/team/matrix.txt',
            '/files/groups/team/matrix-moved.txt',
            'groups/team/matrix.txt',
            'groups/team/matrix-moved.txt',
        ];
    }

    #[DataProvider('trees')]
    public function test_propfind_lists_the_named_file_in_the_collection(
        string $collection,
        string $fileUrl,
        string $movedUrl,
        string $fileKey,
        string $movedKey,
    ): void {
        unset($fileUrl, $movedUrl, $movedKey);
        Storage::disk('wgw_files')->put($fileKey, 'listed-body');

        $response = $this->dav('PROPFIND', $collection, depth: '1', server: [
            'CONTENT_TYPE' => 'application/xml',
            'HTTP_ACCEPT' => '*/*',
        ], body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>');

        $response->assertStatus(207);
        $body = $response->getContent();
        $this->assertIsString($body);
        $this->assertStringContainsString(basename($fileKey), $body);
    }

    #[DataProvider('trees')]
    public function test_get_returns_the_named_file_body(
        string $collection,
        string $fileUrl,
        string $movedUrl,
        string $fileKey,
        string $movedKey,
    ): void {
        unset($collection, $movedUrl, $movedKey);
        $payload = 'get-body-'.basename($fileKey);
        Storage::disk('wgw_files')->put($fileKey, $payload);

        $response = $this->dav('GET', $fileUrl);
        $response->assertSuccessful();
        $this->assertSame($payload, $response->streamedContent());
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function nonMemberGroupFolderMethods(): iterable
    {
        yield 'PROPFIND' => ['PROPFIND'];
        yield 'GET' => ['GET'];
    }

    #[DataProvider('nonMemberGroupFolderMethods')]
    public function test_non_member_group_folder_is_hidden(string $method): void
    {
        Storage::disk('wgw_files')->put('groups/team/matrix.txt', 'hidden-body');

        $server = [];
        $body = null;
        $depth = null;
        if ($method === 'PROPFIND') {
            $depth = '1';
            $server = [
                'CONTENT_TYPE' => 'application/xml',
                'HTTP_ACCEPT' => '*/*',
            ];
            $body = '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>';
        }

        $this->dav($method, '/files/groups/team', body: $body, server: $server, depth: $depth, username: 'bob')
            ->assertNotFound();
    }

    #[DataProvider('trees')]
    public function test_put_writes_the_named_file(
        string $collection,
        string $fileUrl,
        string $movedUrl,
        string $fileKey,
        string $movedKey,
    ): void {
        unset($collection, $movedUrl, $movedKey);
        $payload = 'put-body-'.basename($fileKey);

        $this->dav('PUT', $fileUrl, body: $payload, server: [
            'CONTENT_TYPE' => 'text/plain',
        ])->assertSuccessful();

        $this->assertTrue(Storage::disk('wgw_files')->exists($fileKey));
        $this->assertSame($payload, Storage::disk('wgw_files')->get($fileKey));
    }

    #[DataProvider('trees')]
    public function test_move_relocates_the_named_file_through_calculate_uri(
        string $collection,
        string $fileUrl,
        string $movedUrl,
        string $fileKey,
        string $movedKey,
    ): void {
        unset($collection);
        Storage::disk('wgw_files')->put($fileKey, 'move-body');

        $this->dav('MOVE', $fileUrl, server: [
            'HTTP_DESTINATION' => 'http://localhost'.$movedUrl,
        ])->assertSuccessful();

        $this->assertFalse(Storage::disk('wgw_files')->exists($fileKey));
        $this->assertTrue(Storage::disk('wgw_files')->exists($movedKey));
        $this->assertSame('move-body', Storage::disk('wgw_files')->get($movedKey));

        $moved = $this->dav('GET', $movedUrl);
        $moved->assertSuccessful();
        $this->assertSame('move-body', $moved->streamedContent());
    }

    #[DataProvider('trees')]
    public function test_delete_removes_the_named_file(
        string $collection,
        string $fileUrl,
        string $movedUrl,
        string $fileKey,
        string $movedKey,
    ): void {
        unset($collection, $movedUrl, $movedKey);
        Storage::disk('wgw_files')->put($fileKey, 'delete-body');

        $this->dav('DELETE', $fileUrl)->assertSuccessful();

        $this->assertFalse(Storage::disk('wgw_files')->exists($fileKey));
        $this->dav('GET', $fileUrl)->assertNotFound();
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(
        string $method,
        string $path,
        ?string $body = null,
        array $server = [],
        ?string $depth = null,
        string $username = 'alice',
    ): TestResponse {
        $server['HTTP_AUTHORIZATION'] = 'Basic '.base64_encode($username.':secret');
        if ($depth !== null) {
            $server['HTTP_DEPTH'] = $depth;
        }
        if ($body !== null && ! in_array($method, ['PUT', 'POST', 'PATCH'], true)) {
            $server['CONTENT_LENGTH'] = (string) strlen($body);
        }

        return $this->call($method, $path, [], [], [], $server, $body);
    }
}

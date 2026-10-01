<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * WebDAV MOVE must rewrite drive_shares.path the same way REST rename does (#455).
 */
final class DriveShareWebdavMoveTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();

        $installRoot = sys_get_temp_dir().'/wgw-share-move-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/bob', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'bob');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->configureWgwJwtKeys();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_webdav_move_rewrites_member_and_public_share_paths(): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'MKCOL', '/files/users/bob/folder')->assertSuccessful();
        $this->dav($dav, 'PUT', '/files/users/bob/folder/note.md', 'shared note')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $alice = $this->issueBearerTokenFor('alice');

        $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/folder',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $publicToken = (string) $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/folder/note.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $this->assertNotSame('', $publicToken);

        $this->dav($dav, 'MOVE', '/files/users/bob/folder', null, [
            'HTTP_DESTINATION' => '/files/users/bob/renamed',
        ])->assertSuccessful();

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/renamed/note.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/folder/note.md'));

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/renamed'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/renamed')
            ->assertJsonPath('data.0.kind', 'member')
            ->assertJsonPath('data.0.shareWith.alice.access', 'edit');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/renamed/note.md'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/renamed/note.md')
            ->assertJsonPath('data.0.kind', 'public');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/folder'))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/folder/note.md'))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($alice)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/renamed'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayEditContent', true);

        $guest = $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk();
        $guest->assertJsonPath('share.path', '/users/bob/renamed/note.md');

        $this->withBearer((string) $guest->json('access_token'))
            ->get('/api/v1/files/content?path='.urlencode('/users/bob/renamed/note.md'))
            ->assertOk();
    }

    public function test_failed_webdav_move_leaves_share_path_unchanged(): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'PUT', '/files/users/bob/keep.md', 'keep')->assertSuccessful();
        $this->dav($dav, 'PUT', '/files/users/bob/other.md', 'other')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/keep.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $this->dav($dav, 'MOVE', '/files/users/bob/keep.md', null, [
            'HTTP_DESTINATION' => '/files/users/bob/other.md',
            'HTTP_OVERWRITE' => 'F',
        ])->assertStatus(412);

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/keep.md'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/keep.md');
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $authorization, string $method, string $uri, ?string $content = null, array $server = []): TestResponse
    {
        return $this->call($method, $uri, [], [], [], array_merge([
            'HTTP_AUTHORIZATION' => $authorization,
            'CONTENT_TYPE' => 'text/plain',
        ], $server), $content);
    }
}

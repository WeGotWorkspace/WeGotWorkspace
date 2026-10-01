<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use PHPUnit\Framework\Attributes\DataProvider;
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
        $this->dav($dav, 'MKCOL', '/files/users/bob/my%20folder')->assertSuccessful();
        $this->dav($dav, 'PUT', '/files/users/bob/my%20folder/note.md', 'shared note')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $alice = $this->issueBearerTokenFor('alice');

        $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/my folder',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $publicToken = (string) $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/my folder/note.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $this->assertNotSame('', $publicToken);

        $this->dav($dav, 'MOVE', '/files/users/bob/my%20folder', null, [
            'HTTP_DESTINATION' => 'http://localhost/files/users/bob/new%20n%C3%A4me',
        ])->assertSuccessful();

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/new näme/note.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/my folder/note.md'));

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/new näme'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/new näme')
            ->assertJsonPath('data.0.kind', 'member')
            ->assertJsonPath('data.0.shareWith.alice.access', 'edit');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/new näme/note.md'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/new näme/note.md')
            ->assertJsonPath('data.0.kind', 'public');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/my folder'))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/my folder/note.md'))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($alice)
            ->getJson('/api/v1/files/shares/at-path?path='.urlencode('/users/bob/new näme'))
            ->assertOk()
            ->assertJsonPath('data.myRights.mayEditContent', true);

        $guest = $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk();
        $guest->assertJsonPath('share.path', '/users/bob/new näme/note.md');

        $this->withBearer((string) $guest->json('access_token'))
            ->get('/api/v1/files/content?path='.urlencode('/users/bob/new näme/note.md'))
            ->assertOk();
    }

    public function test_share_rewrite_failure_still_returns_created_and_moves_file_node(): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'PUT', '/files/users/bob/report.docx', 'body')->assertSuccessful();

        $before = app(FileNodeIndexService::class)->liveByKey('users/bob/report.docx');
        $this->assertNotNull($before);

        // Sessions and grants reference drive_shares, so the children go first.
        Schema::connection('wgw')->dropIfExists('drive_share_sessions');
        Schema::connection('wgw')->dropIfExists('drive_share_grants');
        Schema::connection('wgw')->dropIfExists('drive_shares');

        $this->dav($dav, 'MOVE', '/files/users/bob/report.docx', null, [
            'HTTP_DESTINATION' => '/files/users/bob/saved.docx',
        ])->assertStatus(201);

        $after = app(FileNodeIndexService::class)->liveByKey('users/bob/saved.docx');
        $this->assertNotNull($after);
        $this->assertSame($before->node_id, $after->node_id);
        $this->assertNull(app(FileNodeIndexService::class)->liveByKey('users/bob/report.docx'));
    }

    public function test_office_webdav_save_keeps_the_public_share_on_the_document(): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'PUT', '/files/users/bob/report.docx', 'original')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $publicToken = (string) $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/report.docx',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');

        $this->dav($dav, 'MOVE', '/files/users/bob/report.docx', null, [
            'HTTP_DESTINATION' => '/files/users/bob/~WRL0001.tmp',
        ])->assertSuccessful();
        $this->dav($dav, 'PUT', '/files/users/bob/~WRD0000.tmp', 'saved')->assertSuccessful();
        $this->dav($dav, 'MOVE', '/files/users/bob/~WRD0000.tmp', null, [
            'HTTP_DESTINATION' => '/files/users/bob/report.docx',
        ])->assertSuccessful();
        $this->dav($dav, 'DELETE', '/files/users/bob/~WRL0001.tmp')->assertSuccessful();

        $guest = $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk();
        $guest->assertJsonPath('share.path', '/users/bob/report.docx');

        $this->withBearer((string) $guest->json('access_token'))
            ->get('/api/v1/files/content?path='.urlencode('/users/bob/report.docx'))
            ->assertOk();
    }

    #[DataProvider('swapTempDestinations')]
    public function test_swap_temp_destination_does_not_rewrite_share_path(string $destinationName): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'PUT', '/files/users/bob/report.docx', 'original')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/report.docx',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $this->dav($dav, 'MOVE', '/files/users/bob/report.docx', null, [
            'HTTP_DESTINATION' => '/files/users/bob/'.rawurlencode($destinationName),
        ])->assertSuccessful();

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/report.docx'))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/report.docx');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function swapTempDestinations(): array
    {
        return [
            'tilde prefix' => ['~WRL0001.tmp'],
            'tmp suffix' => ['report.tmp'],
            'office lock' => ['.~lock.report.docx#'],
            'backup tilde' => ['report.docx~'],
            'emacs lock' => ['.#report.docx'],
        ];
    }

    #[DataProvider('tempNamedFolderDestinations')]
    public function test_temp_named_folder_move_rewrites_share_path(string $destinationName): void
    {
        $dav = 'Basic '.base64_encode('bob:secret');
        $this->dav($dav, 'MKCOL', '/files/users/bob/shared')->assertSuccessful();

        $owner = $this->issueBearerTokenFor('bob');
        $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => ['alice' => ['access' => 'edit']],
        ])->assertOk();

        $this->dav($dav, 'MOVE', '/files/users/bob/shared', null, [
            'HTTP_DESTINATION' => '/files/users/bob/'.rawurlencode($destinationName),
        ])->assertSuccessful();

        $this->withBearer($owner)
            ->getJson('/api/v1/files/shares?path='.urlencode('/users/bob/'.$destinationName))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.path', '/users/bob/'.$destinationName)
            ->assertJsonPath('data.0.shareWith.alice.access', 'edit');
    }

    /**
     * @return array<string, array{string}>
     */
    public static function tempNamedFolderDestinations(): array
    {
        return [
            'tilde folder' => ['~archive'],
        ];
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

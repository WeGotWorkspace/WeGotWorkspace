<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Services\Collab\CollabExternalWrite;
use App\Services\Drive\DocAttachmentPaths;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class CollabSidecarDavTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-att-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/alice', 0775, true);
        mkdir($this->dataDir.'/files/users/alice/'.DocAttachmentPaths::DIR, 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($this->dataDir);
    }

    public function test_propfind_hides_the_yjs_sidecar(): void
    {
        $this->seedDocumentAndSidecar();

        $response = $this->dav(
            'PROPFIND',
            '/files/users/alice',
            '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
            [
                'CONTENT_TYPE' => 'application/xml',
                'HTTP_ACCEPT' => '*/*',
            ],
            '1',
        );

        $response->assertStatus(207);
        $body = $response->getContent();
        $this->assertIsString($body);
        $this->assertStringContainsString('together.md', $body);
        $this->assertStringNotContainsString('together.md.yjs', $body);
    }

    public function test_put_on_the_sidecar_is_forbidden(): void
    {
        $this->seedDocumentAndSidecar();

        $this->dav('PUT', '/files/users/alice/.together.md.yjs', 'overwrite')->assertStatus(403);

        $this->assertSame('yjs-bytes', Storage::disk('wgw_files')->get('users/alice/.together.md.yjs'));
    }

    public function test_delete_on_the_sidecar_is_forbidden(): void
    {
        $this->seedDocumentAndSidecar();

        $this->dav('DELETE', '/files/users/alice/.together.md.yjs')->assertStatus(403);

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/alice/.together.md.yjs'));
    }

    public function test_move_onto_a_sidecar_name_is_forbidden(): void
    {
        $this->seedDocumentAndSidecar();

        $this->dav('MOVE', '/files/users/alice/together.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/.other.md.yjs',
        ])->assertStatus(403);

        $this->assertSame('# doc', Storage::disk('wgw_files')->get('users/alice/together.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/.other.md.yjs'));
    }

    public function test_move_onto_a_document_with_a_sidecar_is_forbidden(): void
    {
        $this->seedDocumentAndSidecar();
        Storage::disk('wgw_files')->put('users/alice/scratch.md', 'scratch');

        $this->dav('MOVE', '/files/users/alice/scratch.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/together.md',
        ])->assertStatus(403);

        $this->assertTrue(Storage::disk('wgw_files')->exists('users/alice/scratch.md'));
        $this->assertSame('# doc', Storage::disk('wgw_files')->get('users/alice/together.md'));
    }

    public function test_delete_on_a_document_with_a_sidecar_is_allowed(): void
    {
        $this->seedDocumentAndSidecar();

        $this->dav('DELETE', '/files/users/alice/together.md')->assertStatus(204);

        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/together.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/.together.md.yjs'));
    }

    public function test_move_of_a_document_with_a_sidecar_is_allowed(): void
    {
        $this->seedDocumentAndSidecar();

        $response = $this->dav('MOVE', '/files/users/alice/together.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/renamed.md',
        ]);

        $this->assertContains($response->getStatusCode(), [201, 204]);
        $this->assertSame('# doc', Storage::disk('wgw_files')->get('users/alice/renamed.md'));
        $this->assertSame('yjs-bytes', Storage::disk('wgw_files')->get('users/alice/.renamed.md.yjs'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/.together.md.yjs'));
    }

    /**
     * #1349 replaced the #1291 write block with detection: the write lands,
     * the sidecar is untouched, and the next yjs read flags the change.
     */
    public function test_put_on_a_document_with_a_sidecar_is_allowed_and_flagged(): void
    {
        $this->seedDocumentAndSidecar();

        $this->assertContains(
            $this->dav('PUT', '/files/users/alice/together.md', 'external edit')->getStatusCode(),
            [201, 204],
        );

        $this->assertSame('external edit', Storage::disk('wgw_files')->get('users/alice/together.md'));
        $this->assertSame('yjs-bytes', Storage::disk('wgw_files')->get('users/alice/.together.md.yjs'));
        $this->configureWgwJwtKeys();
        $this->withBearer($this->issueBearerToken())
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/alice/together.md').'&format=yjs')
            ->assertOk()
            ->assertHeader(CollabExternalWrite::HEADER, '1');
    }

    public function test_put_on_a_document_without_a_sidecar_still_works(): void
    {
        $this->seedDocumentAndSidecar();

        $response = $this->dav('PUT', '/files/users/alice/plain.md', 'plain-body');

        $this->assertContains($response->getStatusCode(), [201, 204]);
        $this->assertSame('plain-body', Storage::disk('wgw_files')->get('users/alice/plain.md'));
    }

    public function test_move_into_another_folder_moves_the_sidecar(): void
    {
        $this->seedDocumentAndSidecar();
        Storage::disk('wgw_files')->makeDirectory('users/alice/archive');

        $response = $this->dav('MOVE', '/files/users/alice/together.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/archive/together.md',
        ]);

        $this->assertContains($response->getStatusCode(), [201, 204]);
        $this->assertSame('yjs-bytes', Storage::disk('wgw_files')->get('users/alice/archive/.together.md.yjs'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/.together.md.yjs'));
    }

    public function test_copy_leaves_the_sidecar_on_the_source(): void
    {
        $this->seedDocumentAndSidecar();

        $response = $this->dav('COPY', '/files/users/alice/together.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/copy.md',
        ]);

        $this->assertContains($response->getStatusCode(), [201, 204]);
        $this->assertSame('# doc', Storage::disk('wgw_files')->get('users/alice/copy.md'));
        $this->assertFalse(Storage::disk('wgw_files')->exists('users/alice/.copy.md.yjs'));
        $this->assertSame('yjs-bytes', Storage::disk('wgw_files')->get('users/alice/.together.md.yjs'));
    }

    public function test_directory_move_and_delete_carry_nested_sidecars(): void
    {
        $disk = Storage::disk('wgw_files');
        $disk->makeDirectory('users/alice/notes');
        $disk->put('users/alice/notes/together.md', '# doc');
        $disk->put('users/alice/notes/.together.md.yjs', 'yjs-bytes');

        $moved = $this->dav('MOVE', '/files/users/alice/notes', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/renamed-notes',
        ]);

        $this->assertContains($moved->getStatusCode(), [201, 204]);
        $this->assertSame('yjs-bytes', $disk->get('users/alice/renamed-notes/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/notes/.together.md.yjs'));

        $this->dav('DELETE', '/files/users/alice/renamed-notes')->assertStatus(204);
        $this->assertFalse($disk->exists('users/alice/renamed-notes/.together.md.yjs'));
        $this->assertFalse($disk->exists('users/alice/renamed-notes/together.md'));
    }

    private function seedDocumentAndSidecar(): void
    {
        Storage::disk('wgw_files')->put('users/alice/together.md', '# doc');
        Storage::disk('wgw_files')->put('users/alice/.together.md.yjs', 'yjs-bytes');
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

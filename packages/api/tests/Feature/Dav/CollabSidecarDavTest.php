<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

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

    public function test_put_on_a_document_with_a_sidecar_is_forbidden(): void
    {
        $this->seedDocumentAndSidecar();

        $this->dav('PUT', '/files/users/alice/together.md', 'external edit')->assertStatus(403);

        $this->assertSame('# doc', Storage::disk('wgw_files')->get('users/alice/together.md'));
    }

    public function test_put_on_a_document_without_a_sidecar_still_works(): void
    {
        $this->seedDocumentAndSidecar();

        $response = $this->dav('PUT', '/files/users/alice/plain.md', 'plain-body');

        $this->assertContains($response->getStatusCode(), [201, 204]);
        $this->assertSame('plain-body', Storage::disk('wgw_files')->get('users/alice/plain.md'));
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

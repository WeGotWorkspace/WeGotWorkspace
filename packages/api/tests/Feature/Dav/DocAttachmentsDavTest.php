<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Services\Drive\DocAttachmentPaths;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

final class DocAttachmentsDavTest extends WgwDatabaseTestCase
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

    public function test_propfind_hides_attachments_from_children(): void
    {
        Storage::disk('wgw_files')->put('users/alice/visible.md', 'doc');
        $auth = 'Basic '.base64_encode('alice:secret');

        $response = $this->call('PROPFIND', '/files/users/alice', [], [], [], [
            'HTTP_AUTHORIZATION' => $auth,
            'HTTP_DEPTH' => '1',
            'CONTENT_TYPE' => 'application/xml',
            'HTTP_ACCEPT' => '*/*',
        ], '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>');

        $response->assertStatus(207);
        $body = $response->getContent();
        $this->assertIsString($body);
        $this->assertStringContainsString('visible.md', $body);
        $this->assertStringNotContainsString(DocAttachmentPaths::DIR, $body);
    }

    public function test_client_writes_under_attachments_are_forbidden(): void
    {
        $auth = 'Basic '.base64_encode('alice:secret');
        $path = '/files/users/alice/'.DocAttachmentPaths::DIR.'/fn-'.str_repeat('a', 32).'/x.png';

        $this->call(
            'PUT',
            $path,
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => $auth,
                'CONTENT_TYPE' => 'image/png',
            ],
            'bytes',
        )->assertStatus(403);

        $this->call(
            'DELETE',
            '/files/users/alice/'.DocAttachmentPaths::DIR,
            [],
            [],
            [],
            ['HTTP_AUTHORIZATION' => $auth],
        )->assertStatus(403);

        $this->call(
            'MKCOL',
            '/files/users/alice/'.DocAttachmentPaths::DIR.'/nested',
            [],
            [],
            [],
            ['HTTP_AUTHORIZATION' => $auth],
        )->assertStatus(403);
    }
}

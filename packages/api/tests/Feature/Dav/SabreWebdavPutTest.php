<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Http\Support\WgwOversizedPost;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class SabreWebdavPutTest extends WgwDatabaseTestCase
{
    private string $dataDir;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-put-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $this->dataDir = $installRoot.'/wgw-content';
        mkdir($this->dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $this->dataDir);
        WgwInstallFixture::markInstalled($installRoot, $this->dataDir, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $this->dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
    }

    public function test_put_persists_file_body_through_laravel_front(): void
    {
        $payload = 'docx-save-payload-'.random_bytes(8);
        $auth = 'Basic '.base64_encode('alice:secret');

        $this->call(
            'PUT',
            '/files/users/alice/report.docx',
            [],
            [],
            [],
            [
                'HTTP_AUTHORIZATION' => $auth,
                'CONTENT_TYPE' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
            $payload,
        )->assertSuccessful();

        $disk = Storage::disk('wgw_files');
        $this->assertTrue($disk->exists('users/alice/report.docx'));
        $this->assertSame($payload, $disk->get('users/alice/report.docx'));
    }

    public function test_put_larger_than_post_max_size_is_stored(): void
    {
        $server = [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:secret'),
            'CONTENT_TYPE' => 'application/octet-stream',
            'CONTENT_LENGTH' => (string) (WgwOversizedPost::iniBytes((string) ini_get('post_max_size')) + 1),
        ];

        $this->assertFalse(WgwOversizedPost::exceedsLimit(Request::create('/files/users/alice/big.bin', 'PUT', server: $server)));
        $this->assertTrue(WgwOversizedPost::exceedsLimit(Request::create('/api/v1/files/collaboration', 'PUT', server: $server)));
        $this->assertTrue(WgwOversizedPost::exceedsLimit(Request::create('/calendars/alice/default/big.ics', 'PUT', server: $server)));
        $this->call('PUT', '/files/users/alice/big.bin', [], [], [], $server, 'x')->assertSuccessful();
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/alice/big.bin'));
    }
}

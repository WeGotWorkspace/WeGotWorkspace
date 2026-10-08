<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\User;
use App\Support\WgwSettings;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class DavBrowserPluginDefaultTest extends WgwDatabaseTestCase
{
    private string $installRoot;

    protected function setUp(): void
    {
        parent::setUp();

        User::factory()->named('alice')->create();

        $this->installRoot = sys_get_temp_dir().'/wgw-browser-default-'.uniqid('', true);
        mkdir($this->installRoot, 0775, true);
        file_put_contents($this->installRoot.'/index.php', "<?php\n");
        $data = $this->installRoot.'/wgw-content';
        mkdir($data.'/files/users', 0775, true);
        mkdir($data.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($this->installRoot, $data);
        WgwInstallFixture::markInstalled($this->installRoot, $data, 'alice');

        config(['wgw.install_root' => $this->installRoot, 'wgw.data_dir' => $data]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BASE_URI, '/dav/');
    }

    public function test_dav_root_with_basic_auth_is_not_the_html_browser(): void
    {
        $response = $this->call('GET', '/dav/', [], [], [], [
            'HTTP_AUTHORIZATION' => 'Basic '.base64_encode('alice:secret'),
        ]);

        $type = (string) $response->headers->get('Content-Type');
        $this->assertStringNotContainsString('text/html', $type);
        $this->assertStringNotContainsString('sabreAction', $response->getContent());
    }
}

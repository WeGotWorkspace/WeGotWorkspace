<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Models\User;
use App\Support\WgwSettings;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class SabreBrowserAssetTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        User::factory()->named('alice')->create();

        $installRoot = sys_get_temp_dir().'/wgw-browser-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $data = $installRoot.'/wgw-content';
        mkdir($data.'/files/users', 0775, true);
        mkdir($data.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $data);
        WgwInstallFixture::markInstalled($installRoot, $data, 'alice');

        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $data]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, true);
    }

    public function test_sabre_browser_css_is_not_served_by_ui_shell(): void
    {
        $auth = 'Basic '.base64_encode('alice:secret');

        $response = $this->call(
            'GET',
            '/?sabreAction=asset&assetName=sabredav.css',
            [],
            [],
            [],
            ['HTTP_AUTHORIZATION' => $auth],
        );

        $response->assertOk();
        $this->assertStringStartsWith('text/css', (string) $response->headers->get('Content-Type'));
        $this->assertStringContainsString('box-sizing', $response->streamedContent());
    }
}

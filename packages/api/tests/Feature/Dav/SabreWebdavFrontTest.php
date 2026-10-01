<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\SabreServerFactory;
use App\Support\AppPaths;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;

final class SabreWebdavFrontTest extends WgwDatabaseTestCase
{
    public function test_sabre_server_factory_builds_when_installed(): void
    {

        $installRoot = sys_get_temp_dir().'/wgw-sabre-root-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $data = $installRoot.'/wgw-content';
        mkdir($data.'/files/users', 0775, true);
        mkdir($data.'/files/groups', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $data);
        WgwInstallFixture::markInstalled($installRoot, $data);

        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();

        $factory = $this->app->make(SabreServerFactory::class);
        $server = $factory->create();
        $this->assertSame('/', $server->getBaseUri());
        $this->assertNotNull($server->getPlugin('drive-star-path'));

        $this->assertTrue($this->app->make(AppPaths::class)->isInstalled());
    }
}

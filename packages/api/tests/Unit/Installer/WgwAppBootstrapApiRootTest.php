<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use PHPUnit\Framework\Attributes\RunTestsInSeparateProcesses;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

#[RunTestsInSeparateProcesses]
final class WgwAppBootstrapApiRootTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->clearApiRootEnv();
        $bootstrapDir = dirname(__DIR__, 5).'/apps/wegotworkspace/bootstrap';
        require_once $bootstrapDir.'/WgwSafePath.php';
        require_once $bootstrapDir.'/WgwAppBootstrap.php';
    }

    protected function tearDown(): void
    {
        $this->clearApiRootEnv();
        parent::tearDown();
    }

    public function test_docker_install_docroot_prefers_bind_mounted_api_over_nested_copy(): void
    {
        $candidates = $this->candidates('/var/www/install', '/var/www/install');
        $this->assertSame('/var/www/packages/api', $candidates[0]);
        $this->assertContains('/var/www/install/packages/api', $candidates);
    }

    public function test_host_monorepo_install_prefers_sibling_packages_api(): void
    {
        $candidates = $this->candidates(
            '/srv/sabre-installer/apps/wegotworkspace',
            '/srv/sabre-installer/apps/wegotworkspace',
        );
        $this->assertSame('/srv/sabre-installer/packages/api', $candidates[0]);
        $this->assertContains('/srv/sabre-installer/apps/wegotworkspace/packages/api', $candidates);
    }

    public function test_packaged_install_does_not_escape_to_var_www_packages_api(): void
    {
        $candidates = $this->candidates('/var/www/html', '/var/www/html');
        $this->assertSame(['/var/www/html/packages/api'], $candidates);
        $this->assertNotContains('/var/www/packages/api', $candidates);
    }

    public function test_wgw_api_root_env_wins_over_docker_and_nested_paths(): void
    {
        putenv('WGW_API_ROOT=/tmp/live-api');
        $_ENV['WGW_API_ROOT'] = '/tmp/live-api';
        $_SERVER['WGW_API_ROOT'] = '/tmp/live-api';

        $candidates = $this->candidates('/var/www/install', '/var/www/install');
        $this->assertSame('/tmp/live-api', $candidates[0]);
        $this->assertContains('/var/www/packages/api', $candidates);
    }

    public function test_resolve_uses_wgw_api_root_when_nested_copy_also_has_vendor(): void
    {
        $appRoot = sys_get_temp_dir().'/wgw-install-'.uniqid('', true);
        mkdir($appRoot.'/packages/api/public', 0775, true);
        mkdir($appRoot.'/packages/api/vendor', 0775, true);
        file_put_contents($appRoot.'/packages/api/public/index.php', "<?php\n");
        file_put_contents($appRoot.'/packages/api/vendor/autoload.php', "<?php\n");

        $live = $this->makeApiTree('live');
        putenv('WGW_API_ROOT='.$live);
        $_SERVER['WGW_API_ROOT'] = $live;

        $resolved = $this->resolve($appRoot, $appRoot);
        $this->assertSame($live, $resolved);
    }

    /**
     * @return list<string>
     */
    private function candidates(string $appRoot, string $runtimeRoot): array
    {
        $method = new ReflectionMethod(\WgwAppBootstrap::class, 'apiPackageCandidates');

        /** @var list<string> $candidates */
        $candidates = $method->invoke(null, $appRoot, $runtimeRoot);

        return $candidates;
    }

    private function resolve(string $appRoot, string $runtimeRoot): ?string
    {
        $method = new ReflectionMethod(\WgwAppBootstrap::class, 'resolveApiPackageRoot');

        /** @var ?string $root */
        $root = $method->invoke(null, $appRoot, $runtimeRoot);

        return $root;
    }

    private function makeApiTree(string $suffix): string
    {
        $root = sys_get_temp_dir().'/wgw-api-root-'.$suffix.'-'.uniqid('', true);
        mkdir($root.'/public', 0775, true);
        mkdir($root.'/vendor', 0775, true);
        file_put_contents($root.'/public/index.php', "<?php\n");
        file_put_contents($root.'/vendor/autoload.php', "<?php\n");

        return $root;
    }

    private function clearApiRootEnv(): void
    {
        putenv('WGW_API_ROOT');
        unset($_ENV['WGW_API_ROOT'], $_SERVER['WGW_API_ROOT']);
    }
}

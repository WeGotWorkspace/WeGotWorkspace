<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Admin\AdminStateService;
use App\Services\Update\ShippedInstallEnvHardening;
use App\Support\WgwApiEnvFile;
use App\Support\WgwInstallConfig;
use Tests\Support\WgwDatabaseTestCase;

final class AdminStateEnvHardeningTest extends WgwDatabaseTestCase
{
    private string $root = '';

    protected function tearDown(): void
    {
        if ($this->root !== '' && is_dir($this->root)) {
            $this->removeTree($this->root);
        }

        parent::tearDown();
    }

    public function test_admin_state_rewrites_local_app_env_and_keeps_the_warning_when_env_is_read_only(): void
    {
        $writable = $this->prepareInstall('APP_ENV=local'."\n");
        $snapshot = $this->adminState();

        $written = (string) file_get_contents($writable);
        $this->assertSame('production', WgwApiEnvFile::readValue($written, 'APP_ENV'));
        $this->assertContains(
            'Production settings were applied; reload the page',
            $snapshot['securityWarnings'],
        );

        $readOnly = $this->prepareInstall('APP_ENV=local'."\n");
        chmod(dirname($readOnly), 0555);
        try {
            $kept = $this->adminState();
        } finally {
            chmod(dirname($readOnly), 0755);
        }

        $this->assertSame('local', WgwApiEnvFile::readValue((string) file_get_contents($readOnly), 'APP_ENV'));
        $this->assertContains('APP_ENV is local, not production.', $kept['securityWarnings']);
        $this->assertNotContains(
            'Production settings were applied; reload the page',
            $kept['securityWarnings'],
        );
    }

    private function prepareInstall(string $env): string
    {
        if ($this->root !== '' && is_dir($this->root)) {
            $this->removeTree($this->root);
        }

        $this->root = sys_get_temp_dir().'/wgw-admin-env-'.uniqid('', true);
        $api = $this->root.'/packages/api';
        mkdir($api, 0775, true);
        $path = $api.'/.env';
        file_put_contents($path, $env);

        config([
            'wgw.install_root' => $this->root,
            'wgw.install_channel' => 'docker',
            'app.env' => 'local',
            'app.debug' => false,
            'app.url' => 'https://wgw.example.test',
        ]);
        $this->app['env'] = 'local';
        $this->app->forgetInstance(WgwInstallConfig::class);
        $this->app->forgetInstance(ShippedInstallEnvHardening::class);
        $this->app->forgetInstance(AdminStateService::class);

        return $path;
    }

    /**
     * @return array<string, mixed>
     */
    private function adminState(): array
    {
        return app(AdminStateService::class)->snapshot('alice');
    }

    private function removeTree(string $dir): void
    {
        if (is_dir($dir)) {
            chmod($dir, 0755);
        }
        $items = scandir($dir);
        if ($items === false) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $path = $dir.'/'.$item;
            if (is_dir($path)) {
                $this->removeTree($path);

                continue;
            }
            chmod($path, 0644);
            unlink($path);
        }
        rmdir($dir);
    }
}

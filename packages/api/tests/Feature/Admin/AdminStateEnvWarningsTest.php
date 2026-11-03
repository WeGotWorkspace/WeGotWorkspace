<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use App\Services\Admin\AdminStateService;
use App\Support\WgwInstallConfig;
use Tests\Support\WgwDatabaseTestCase;

final class AdminStateEnvWarningsTest extends WgwDatabaseTestCase
{
    /** @var list<string> */
    private array $roots = [];

    protected function tearDown(): void
    {
        foreach ($this->roots as $root) {
            foreach (glob($root.'/packages/api/.env*') ?: [] as $path) {
                @unlink($path);
            }
            @rmdir($root.'/packages/api');
            @rmdir($root.'/packages');
            @rmdir($root);
        }

        parent::tearDown();
    }

    public function test_admin_state_warns_about_local_and_debug_without_rewriting_the_env_file(): void
    {
        // Shipped installs are hardened by the 2026_10_06_000440 migration.
        // Reading admin state must never write packages/api/.env.
        foreach (['docker', 'zip'] as $channel) {
            $path = $this->prepareInstall("APP_ENV=local\nAPP_DEBUG=true\n", $channel);

            $warnings = app(AdminStateService::class)->snapshot('alice')['securityWarnings'];

            $this->assertSame("APP_ENV=local\nAPP_DEBUG=true\n", (string) file_get_contents($path), $channel);
            $codes = array_column($warnings, 'code');
            $this->assertContains('app_debug_on', $codes, $channel);
            $this->assertContains('app_env_not_production', $codes, $channel);
            $this->assertNotContains('production_settings_applied', $codes, $channel);
        }
    }

    private function prepareInstall(string $env, string $channel): string
    {
        $root = sys_get_temp_dir().'/wgw-admin-env-'.uniqid('', true);
        $this->roots[] = $root;
        $api = $root.'/packages/api';
        mkdir($api, 0775, true);
        $path = $api.'/.env';
        file_put_contents($path, $env);

        config([
            'wgw.install_root' => $root,
            'wgw.install_channel' => $channel,
            'app.env' => 'local',
            'app.debug' => true,
            'app.url' => 'https://wgw.example.test',
        ]);
        $this->app['env'] = 'local';
        $this->app->forgetInstance(WgwInstallConfig::class);
        $this->app->forgetInstance(AdminStateService::class);

        return $path;
    }
}

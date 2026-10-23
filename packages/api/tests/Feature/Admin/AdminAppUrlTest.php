<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class AdminAppUrlTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    private string $envDir = '';

    private string $originalEnvPath = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
        $this->originalEnvPath = $this->app->environmentPath();
        $this->envDir = sys_get_temp_dir().'/wgw-app-url-'.uniqid('', true);
        mkdir($this->envDir, 0775, true);
        file_put_contents($this->envDir.'/.env', "APP_URL=http://localhost\n");
        $this->app->useEnvironmentPath($this->envDir);
    }

    protected function tearDown(): void
    {
        if ($this->originalEnvPath !== '') {
            $this->app->useEnvironmentPath($this->originalEnvPath);
        }
        if ($this->envDir !== '' && is_dir($this->envDir)) {
            foreach (glob($this->envDir.'/.env*') ?: [] as $path) {
                @unlink($path);
            }
            @rmdir($this->envDir);
        }
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_user_cannot_set_app_url(): void
    {
        $before = (string) file_get_contents($this->envDir.'/.env');

        $this->withBearer($this->userBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => 'https://wgw.example'])
            ->assertForbidden();

        $this->assertSame($before, (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_admin_writes_a_valid_app_url(): void
    {
        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => 'https://wgw.example/'])
            ->assertOk()
            ->assertJsonPath('url', 'https://wgw.example');

        $this->assertStringContainsString(
            'APP_URL=https://wgw.example',
            (string) file_get_contents($this->envDir.'/.env'),
        );
    }

    public function test_admin_overwrites_an_export_app_url_line(): void
    {
        // dotenv loads the export line, so that is the one to replace.
        file_put_contents($this->envDir.'/.env', "APP_URL=http://localhost\nexport APP_URL=https://old.example\n");

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => 'https://wgw.example'])
            ->assertOk()
            ->assertJsonPath('url', 'https://wgw.example');

        $this->assertSame(
            "APP_URL=https://wgw.example\nAPP_URL=https://wgw.example\n",
            (string) file_get_contents($this->envDir.'/.env'),
        );
    }

    public function test_admin_rejects_unsafe_app_urls(): void
    {
        $before = (string) file_get_contents($this->envDir.'/.env');
        $token = $this->adminBearerToken();

        foreach ([
            'javascript:alert(1)',
            'https://user:secret@wgw.example',
            'https://wgw.example/?next=1',
        ] as $url) {
            $this->withBearer($token)
                ->putJson('/api/v1/admin/settings/app-url', ['url' => $url])
                ->assertStatus(422);
        }

        $this->assertSame($before, (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_admin_gets_409_when_the_env_file_is_not_writable(): void
    {
        chmod($this->envDir.'/.env', 0444);

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => 'https://wgw.example'])
            ->assertStatus(409);

        $this->assertStringContainsString('APP_URL=http://localhost', (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_production_health_rejects_an_untrusted_host(): void
    {
        $this->app['env'] = 'production';
        config(['app.url' => 'https://wgw.example']);

        $this->getJson('http://attacker.example/api/v1/health')->assertStatus(400);
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Admin;

use Dotenv\Dotenv;
use Illuminate\Testing\TestResponse;
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

    public function test_admin_app_url_is_not_expanded_by_dotenv(): void
    {
        // Laravel expands ${...} at boot; a saved URL must load exactly as saved.
        $url = 'https://a${APP_KEY}.example';

        $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => $url])
            ->assertOk();

        $loaded = Dotenv::parse("APP_KEY=secret\n".(string) file_get_contents($this->envDir.'/.env'));
        $this->assertSame($url, $loaded['APP_URL']);
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

    public function test_a_read_only_env_file_gets_the_line_to_set_by_hand(): void
    {
        chmod($this->envDir.'/.env', 0444);

        $this->putAppUrl('https://wgw.example')
            ->assertStatus(409)
            ->assertJsonPath('error', 'The web server cannot write packages/api/.env. Add this line there by hand, or make the file writable for the web server: APP_URL=https://wgw.example');

        $this->assertStringContainsString('APP_URL=http://localhost', (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_the_line_to_set_by_hand_is_quoted_like_a_written_line(): void
    {
        // Pasted as-is, the suggested line must not let Laravel expand ${...}.
        chmod($this->envDir.'/.env', 0444);
        $url = 'https://a${APP_KEY}.example';

        $error = (string) $this->putAppUrl($url)->assertStatus(409)->json('error');

        $line = substr($error, (int) strrpos($error, ': ') + 2);
        $this->assertSame($url, Dotenv::parse("APP_KEY=secret\n".$line)['APP_URL']);
    }

    public function test_a_read_only_env_folder_gets_the_line_to_set_by_hand(): void
    {
        // The file is replaced with a lock file and a rename, both in its folder.
        chmod($this->envDir, 0555);
        try {
            $response = $this->putAppUrl('https://wgw.example');
        } finally {
            chmod($this->envDir, 0775);
        }

        $response->assertStatus(409)
            ->assertJsonPath('error', 'The web server cannot replace packages/api/.env: it needs write access to the folder that holds it. Add this line there by hand: APP_URL=https://wgw.example');
        $this->assertSame("APP_URL=http://localhost\n", (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_a_missing_env_file_gets_the_line_to_set_by_hand(): void
    {
        unlink($this->envDir.'/.env');

        $this->putAppUrl('https://wgw.example')
            ->assertStatus(409)
            ->assertJsonPath('error', 'packages/api/.env does not exist. Create it from packages/api/.env.example and add this line: APP_URL=https://wgw.example');

        $this->assertFileDoesNotExist($this->envDir.'/.env');
    }

    public function test_a_cached_config_is_not_written_behind_its_back(): void
    {
        // Laravel ignores .env while config is cached, so a write would not apply.
        $this->app->instance('config_loaded_from_cache', true);
        $response = $this->putAppUrl('https://wgw.example');

        $response->assertStatus(409)
            ->assertJsonPath('error', 'The configuration is cached, so packages/api/.env is not read. Add this line there, then run php artisan config:clear: APP_URL=https://wgw.example');
        $this->assertSame("APP_URL=http://localhost\n", (string) file_get_contents($this->envDir.'/.env'));
    }

    public function test_production_health_rejects_an_untrusted_host(): void
    {
        $this->app['env'] = 'production';
        config(['app.url' => 'https://wgw.example']);

        $this->getJson('http://attacker.example/api/v1/health')->assertStatus(400);
    }

    private function putAppUrl(string $url): TestResponse
    {
        return $this->withBearer($this->adminBearerToken())
            ->putJson('/api/v1/admin/settings/app-url', ['url' => $url]);
    }
}

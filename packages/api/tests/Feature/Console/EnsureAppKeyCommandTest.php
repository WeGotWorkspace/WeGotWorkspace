<?php

declare(strict_types=1);

namespace Tests\Feature\Console;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

final class EnsureAppKeyCommandTest extends TestCase
{
    private string $envDir = '';

    private string $originalEnvPath = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->originalEnvPath = $this->app->environmentPath();
        $this->envDir = sys_get_temp_dir().'/wgw-ensure-app-key-'.uniqid('', true);
        mkdir($this->envDir, 0775, true);
        $this->app->useEnvironmentPath($this->envDir);
    }

    protected function tearDown(): void
    {
        if ($this->originalEnvPath !== '') {
            $this->app->useEnvironmentPath($this->originalEnvPath);
        }
        foreach (glob($this->envDir.'/.env*') ?: [] as $path) {
            @unlink($path);
        }
        @rmdir($this->envDir);
        parent::tearDown();
    }

    public function test_it_generates_a_key_once_when_the_loaded_key_is_empty(): void
    {
        file_put_contents($this->envDir.'/.env', "APP_NAME=WGW\nAPP_KEY=\nAPP_URL=http://localhost\n");
        config(['app.key' => '']);

        $this->assertSame(Command::SUCCESS, Artisan::call('wgw:ensure-app-key'));

        $after = (string) file_get_contents($this->envDir.'/.env');
        $this->assertMatchesRegularExpression('/^APP_KEY=base64:[A-Za-z0-9+\/]{43}=$/m', $after);
        $this->assertSame(1, substr_count($after, 'APP_KEY='));

        // Next start: the key is loaded, so nothing is written.
        $this->assertSame(Command::SUCCESS, Artisan::call('wgw:ensure-app-key'));
        $this->assertSame($after, file_get_contents($this->envDir.'/.env'));
    }

    public function test_it_never_replaces_a_loaded_key(): void
    {
        $content = "APP_KEY=\nAPP_KEY=base64:YWJj\n";
        file_put_contents($this->envDir.'/.env', $content);
        config(['app.key' => 'base64:YWJj']);

        $this->assertSame(Command::SUCCESS, Artisan::call('wgw:ensure-app-key'));

        $this->assertSame($content, file_get_contents($this->envDir.'/.env'));
        $this->assertSame('base64:YWJj', config('app.key'));
    }

    public function test_it_refuses_to_act_on_a_cached_config(): void
    {
        // A cached config does not reflect the .env just loaded. A cached empty
        // key would otherwise make this replace a working key on every install.
        $content = "APP_KEY=base64:YWJj\n";
        file_put_contents($this->envDir.'/.env', $content);
        // Laravel records at boot whether config came from bootstrap/cache.
        $this->app->instance('config_loaded_from_cache', true);
        config(['app.key' => '']);

        $this->assertSame(Command::FAILURE, Artisan::call('wgw:ensure-app-key'));

        $this->assertSame($content, file_get_contents($this->envDir.'/.env'));
    }

    public function test_it_fails_when_there_is_no_app_key_line_to_fill(): void
    {
        $content = "APP_URL=http://localhost\n";
        file_put_contents($this->envDir.'/.env', $content);
        config(['app.key' => '']);

        $this->assertSame(Command::FAILURE, Artisan::call('wgw:ensure-app-key'));

        $this->assertSame($content, file_get_contents($this->envDir.'/.env'));
    }
}

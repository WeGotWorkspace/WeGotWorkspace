<?php

declare(strict_types=1);

namespace Tests\Feature\Installer;

use App\Services\Installer\DataDirChoice;
use App\Services\Settings\SettingKeys;
use Illuminate\Testing\TestResponse;
use Tests\Support\WgwInstallFixture;
use Tests\TestCase;

final class DataDirInstallTest extends TestCase
{
    private string $root = '';

    private string|false $previousDataDir = false;

    private string|false $previousDocumentRoot = false;

    protected function setUp(): void
    {
        $previous = getenv('WGW_DATA_DIR');
        $this->previousDataDir = is_string($previous) ? $previous : false;
        putenv('WGW_DATA_DIR');
        unset($_ENV['WGW_DATA_DIR'], $_SERVER['WGW_DATA_DIR']);
        $documentRoot = $_SERVER['DOCUMENT_ROOT'] ?? null;
        $this->previousDocumentRoot = is_string($documentRoot) ? $documentRoot : false;

        $this->root = sys_get_temp_dir().'/wgw-datadir-install-'.uniqid('', true);
        $install = $this->root.'/public';
        mkdir($install, 0775, true);
        file_put_contents($install.'/index.php', "<?php\n");
        putenv('WGW_APP_ROOT='.$install);
        $_ENV['WGW_APP_ROOT'] = $install;
        $_SERVER['WGW_APP_ROOT'] = $install;
        $_SERVER['DOCUMENT_ROOT'] = $install;
        putenv('WGW_DISABLE_INSTALL_THROTTLE=1');
        $_ENV['WGW_DISABLE_INSTALL_THROTTLE'] = '1';

        parent::setUp();

        WgwInstallFixture::bindInstallRoot($install);
        WgwInstallFixture::ensureApiPackage($install);
    }

    protected function tearDown(): void
    {
        putenv('WGW_DISABLE_INSTALL_THROTTLE');
        unset($_ENV['WGW_DISABLE_INSTALL_THROTTLE']);
        putenv('WGW_APP_ROOT');
        unset($_ENV['WGW_APP_ROOT'], $_SERVER['WGW_APP_ROOT']);
        if (is_string($this->previousDataDir) && $this->previousDataDir !== '') {
            putenv('WGW_DATA_DIR='.$this->previousDataDir);
            $_ENV['WGW_DATA_DIR'] = $this->previousDataDir;
            $_SERVER['WGW_DATA_DIR'] = $this->previousDataDir;
        } else {
            putenv('WGW_DATA_DIR');
            unset($_ENV['WGW_DATA_DIR'], $_SERVER['WGW_DATA_DIR']);
        }
        if (is_string($this->previousDocumentRoot)) {
            $_SERVER['DOCUMENT_ROOT'] = $this->previousDocumentRoot;
        } else {
            unset($_SERVER['DOCUMENT_ROOT']);
        }
        if ($this->root !== '' && is_dir($this->root)) {
            $this->removeTree($this->root);
        }

        parent::tearDown();
    }

    public function test_fresh_install_puts_the_database_outside_the_document_root(): void
    {
        $install = $this->installRoot();
        $outside = $this->root.'/wgw-content';

        $this->postAction('welcome_next')->assertOk()->assertJsonPath('ok', true);
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk()->assertJsonPath('ok', true);
        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
        ])->assertOk()->assertJsonPath('state.data_dir.path', $this->real($outside));
        $this->postAction('site_next', $this->sitePayload())->assertOk()->assertJsonPath('ok', true);
        $this->postAction('install', $this->installPayload())
            ->assertOk()
            ->assertJsonPath('ok', true);

        $env = (string) file_get_contents($install.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DATA_DIR='.$this->real($outside), $env);
        $this->assertStringContainsString('WGW_DB_DATABASE='.$this->real($outside).'/db.sqlite', $env);
        $this->assertFileExists($outside.'/db.sqlite');
        $this->assertFileExists($outside.'/.installed');
        $this->assertFileDoesNotExist($install.'/wgw-content/db.sqlite');

        $db = new \PDO('sqlite:'.$outside.'/db.sqlite');
        $this->assertSame('1', (string) $db->query('SELECT COUNT(*) FROM users')->fetchColumn());
        $this->assertSame('admin', (string) $db->query('SELECT username FROM users')->fetchColumn());
    }

    public function test_invalid_override_is_rejected_and_a_collision_falls_back_with_a_warning(): void
    {
        $install = $this->installRoot();
        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk();

        $rejected = $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
            'data_dir' => 'wgw-content',
        ]);
        $rejected->assertOk()->assertJsonPath('ok', false);
        $this->assertSame(
            'Enter an absolute path for the data directory.',
            $rejected->json('error'),
        );

        $claimed = $this->root.'/wgw-content';
        if (is_dir($claimed)) {
            $this->removeTree($claimed);
        }
        mkdir($claimed, 0775, true);
        file_put_contents($claimed.'/.wgw-owner', "/some/other/install\n");

        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.data_dir.reason', DataDirChoice::REASON_FALLBACK_OWNED);

        $this->postAction('site_next', $this->sitePayload())->assertOk()->assertJsonPath('ok', true);
        $this->postAction('install', $this->installPayload())->assertOk()->assertJsonPath('ok', true);

        $db = new \PDO('sqlite:'.$install.'/wgw-content/db.sqlite');
        $setting = $db->query(
            "SELECT value FROM app_settings WHERE name = '".SettingKeys::DATA_DIR_INSIDE_WEBROOT."'",
        )->fetchColumn();
        $this->assertSame('true', (string) $setting);
        $this->assertSame('admin', (string) $db->query('SELECT username FROM users')->fetchColumn());
    }

    private function installRoot(): string
    {
        return $this->root.'/public';
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function postAction(string $action, array $payload = []): TestResponse
    {
        return $this->postJson('/api/v1/installer/action', [
            'action' => $action,
            'payload' => $payload,
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function sitePayload(): array
    {
        return [
            'timezone' => 'UTC',
            'base_uri_override' => '',
            'enable_files' => true,
            'enable_calendars' => false,
            'enable_contacts' => false,
            'show_browser_ui' => false,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function installPayload(): array
    {
        return [
            'username' => 'admin',
            'display_name' => 'Admin',
            'email' => 'admin@example.test',
            'password' => 'longpassword',
            'password_confirm' => 'longpassword',
            'mail_enabled' => false,
            'meet_enabled' => false,
            'app_url' => 'https://wgw.example.test',
        ];
    }

    private function real(string $path): string
    {
        $real = realpath($path);

        return rtrim(str_replace('\\', '/', $real !== false ? $real : $path), '/');
    }

    private function removeTree(string $dir): void
    {
        if (! is_dir($dir)) {
            return;
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
            if (is_dir($path) && ! is_link($path)) {
                $this->removeTree($path);
            } else {
                @unlink($path);
            }
        }
        @rmdir($dir);
    }
}

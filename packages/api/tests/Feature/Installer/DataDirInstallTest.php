<?php

declare(strict_types=1);

namespace Tests\Feature\Installer;

use App\Services\Installer\DataDirChoice;
use App\Services\Installer\DataDirRejected;
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

    public function test_invalid_override_is_rejected_and_a_taken_name_uses_another_outside_directory(): void
    {
        $install = $this->installRoot();
        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk();

        $rejected = $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
            'data_dir' => 'wgw-content',
        ]);
        $rejected->assertOk()
            ->assertJsonPath('ok', false)
            ->assertJsonPath('error_code', DataDirRejected::NOT_ABSOLUTE);
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
        file_put_contents($claimed.'/db.sqlite', 'keep');

        $suffix = substr(hash('sha256', $this->real($install)), 0, 8);
        $outside = $this->root.'/wgw-content-'.$suffix;
        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.data_dir.reason', DataDirChoice::REASON_OUTSIDE)
            ->assertJsonPath('state.data_dir.path', $this->real($outside));

        $this->postAction('site_next', $this->sitePayload())->assertOk()->assertJsonPath('ok', true);
        $this->postAction('install', $this->installPayload())->assertOk()->assertJsonPath('ok', true);

        $this->assertSame('keep', (string) file_get_contents($claimed.'/db.sqlite'));
        $this->assertFileDoesNotExist($install.'/wgw-content/db.sqlite');
        $db = new \PDO('sqlite:'.$outside.'/db.sqlite');
        $this->assertSame('admin', (string) $db->query('SELECT username FROM users')->fetchColumn());
    }

    public function test_every_refused_data_directory_carries_its_code(): void
    {
        $install = $this->installRoot();
        $owned = $this->root.'/taken';
        mkdir($owned, 0775, true);
        file_put_contents($owned.'/.wgw-owner', "/some/other/install\n");
        file_put_contents($owned.'/db.sqlite', 'keep');

        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk();

        $cases = [
            DataDirRejected::NOT_ABSOLUTE => 'wgw-content',
            DataDirRejected::PARENT_MISSING => $this->root.'/missing/data',
            DataDirRejected::PUBLISHED => $install.'/private-data',
            DataDirRejected::OWNED => $owned,
        ];
        foreach (['database_test', 'database_next'] as $action) {
            foreach ($cases as $code => $dataDir) {
                $this->postAction($action, [
                    'db_driver' => 'sqlite',
                    'sqlite_path' => './wgw-content/db.sqlite',
                    'data_dir' => $dataDir,
                ])->assertOk()
                    ->assertJsonPath('ok', false)
                    ->assertJsonPath('error_code', $code);
            }
        }
    }

    public function test_an_unwritable_parent_is_refused_with_its_code(): void
    {
        if (function_exists('posix_geteuid') && posix_geteuid() === 0) {
            $this->markTestSkipped('root writes through directory permissions.');
        }
        $locked = $this->root.'/locked';
        mkdir($locked, 0555, true);

        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk();

        try {
            $this->postAction('database_next', [
                'db_driver' => 'sqlite',
                'sqlite_path' => './wgw-content/db.sqlite',
                'data_dir' => $locked.'/data',
            ])->assertOk()
                ->assertJsonPath('ok', false)
                ->assertJsonPath('error_code', DataDirRejected::NOT_WRITABLE);
        } finally {
            chmod($locked, 0755);
        }
    }

    public function test_a_database_failure_has_no_data_directory_code(): void
    {
        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'mysql'])->assertOk();

        $response = $this->postAction('database_test', [
            'db_driver' => 'mysql',
            'mysql_host' => '127.0.0.1',
            'mysql_port' => 1,
            'mysql_db' => 'wgw',
            'mysql_user' => 'wgw',
            'mysql_password' => 'secret',
        ])->assertOk()->assertJsonPath('ok', false);

        $this->assertArrayNotHasKey('error_code', $response->json());
    }

    public function test_fallback_is_shown_absolute_and_stored_relative(): void
    {
        $install = $this->installRoot();
        $suffix = substr(hash('sha256', $this->real($install)), 0, 8);
        foreach (['wgw-content', 'wgw-content-'.$suffix] as $name) {
            mkdir($this->root.'/'.$name, 0775, true);
            file_put_contents($this->root.'/'.$name.'/.wgw-owner', "/some/other/install\n");
        }
        $shown = $this->real($install).'/wgw-content';

        $this->postAction('welcome_next')->assertOk();
        $this->postAction('requirements_next', ['db_driver' => 'sqlite'])->assertOk()
            ->assertJsonPath('state.data_dir.path', $shown)
            ->assertJsonPath('state.data_dir.reason', DataDirChoice::REASON_FALLBACK_OWNED)
            ->assertJsonPath('state.data_dir.inside_web_root', true);

        // Typing the shown path back is the same choice, not a rejected override.
        $this->postAction('database_next', [
            'db_driver' => 'sqlite',
            'sqlite_path' => './wgw-content/db.sqlite',
            'data_dir' => $shown,
        ])->assertOk()
            ->assertJsonPath('ok', true)
            ->assertJsonPath('state.data_dir.path', $shown)
            ->assertJsonPath('state.data_dir.reason', DataDirChoice::REASON_FALLBACK_OWNED);

        $this->postAction('site_next', $this->sitePayload())->assertOk()->assertJsonPath('ok', true);
        $this->postAction('install', $this->installPayload())->assertOk()->assertJsonPath('ok', true);

        $env = (string) file_get_contents($install.'/packages/api/.env');
        $this->assertStringContainsString('WGW_DATA_DIR='.DataDirChoice::FALLBACK_PATH."\n", $env);
        $this->assertFileExists($install.'/wgw-content/db.sqlite');
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

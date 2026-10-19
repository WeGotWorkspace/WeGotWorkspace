<?php

declare(strict_types=1);

namespace Tests\Unit\Mcp;

use App\Services\Mcp\PassportKeyStore;
use App\Support\AppPaths;
use App\Support\WgwInstallConfig;
use Laravel\Passport\Passport;
use Tests\Support\UiDistFixture;
use Tests\TestCase;

final class PassportKeyStoreTest extends TestCase
{
    private string $root = '';

    private ?string $previousKeyPath = null;

    protected function setUp(): void
    {
        parent::setUp();

        $this->previousKeyPath = Passport::$keyPath;
        $this->root = sys_get_temp_dir().'/wgw-passport-keys-'.uniqid('', true);
        mkdir($this->root.'/install', 0775, true);
        mkdir($this->root.'/data', 0775, true);
        config([
            'wgw.install_root' => $this->root.'/install',
            'wgw.data_dir' => $this->root.'/data',
        ]);
        app()->forgetInstance(WgwInstallConfig::class);
        app()->forgetInstance(AppPaths::class);
    }

    protected function tearDown(): void
    {
        Passport::$keyPath = $this->previousKeyPath;
        UiDistFixture::removeTree($this->root);

        parent::tearDown();
    }

    public function test_no_keys_are_written_before_the_installer_wrote_the_jwt_pair(): void
    {
        app(PassportKeyStore::class)->ensureInDataDir();

        $this->assertDirectoryDoesNotExist($this->root.'/data/keys');
        $this->assertSame($this->previousKeyPath, Passport::$keyPath);
    }

    public function test_keys_are_written_beside_the_jwt_pair_once_it_exists(): void
    {
        $keys = $this->root.'/data/keys';
        mkdir($keys, 0700, true);
        file_put_contents($keys.'/api-jwt-private.pem', str_repeat('p', 64));
        file_put_contents($keys.'/api-jwt-public.pem', str_repeat('q', 64));

        app(PassportKeyStore::class)->ensureInDataDir();

        $this->assertNotFalse(openssl_pkey_get_private((string) file_get_contents($keys.'/oauth-private.key')));
        $this->assertSame(0600, fileperms($keys.'/oauth-private.key') & 0777);
        $this->assertSame(0640, fileperms($keys.'/oauth-public.key') & 0777);
        $this->assertSame($keys, Passport::$keyPath);
    }
}

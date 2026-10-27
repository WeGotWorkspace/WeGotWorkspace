<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliverySecretFile;
use App\Services\MailDelivery\MailDeliverySecretService;
use App\Support\WgwInstallConfig;
use Tests\Support\UiDistFixture;
use Tests\TestCase;

final class MailDeliverySecretFileTest extends TestCase
{
    private string $root = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/wgw-mail-delivery-secret-'.uniqid('', true);
        mkdir($this->root.'/install', 0775, true);
        mkdir($this->root.'/data', 0775, true);
        config([
            'wgw.install_root' => $this->root.'/install',
            'wgw.data_dir' => $this->root.'/data',
        ]);
        app()->forgetInstance(WgwInstallConfig::class);
    }

    protected function tearDown(): void
    {
        UiDistFixture::removeTree($this->root);

        parent::tearDown();
    }

    public function test_creates_a_secret_when_the_data_dir_has_none(): void
    {
        $file = $this->secretFile();

        $file->ensureSecretFile();

        $this->assertSame(32, strlen((string) file_get_contents($this->primaryPath())));
        $this->assertSame(file_get_contents($this->primaryPath()), $file->readBinary());
    }

    public function test_keeps_an_existing_secret(): void
    {
        $existing = str_repeat('a', 32);
        $this->writeSecret($this->primaryPath(), $existing);
        $this->writeSecret($this->legacyPath(), str_repeat('b', 32));

        $this->secretFile()->ensureSecretFile();

        $this->assertSame($existing, file_get_contents($this->primaryPath()));
    }

    public function test_copies_the_legacy_drive_secret_instead_of_making_a_new_one(): void
    {
        $legacy = str_repeat('l', 40);
        $this->writeSecret($this->legacyPath(), $legacy);

        $this->secretFile()->ensureSecretFile();

        $this->assertSame($legacy, file_get_contents($this->primaryPath()));
    }

    public function test_replaces_a_primary_secret_that_is_too_short(): void
    {
        $this->writeSecret($this->primaryPath(), 'short');

        $this->secretFile()->ensureSecretFile();

        $this->assertSame(32, strlen((string) file_get_contents($this->primaryPath())));
    }

    public function test_reads_the_legacy_secret_when_the_primary_is_missing(): void
    {
        $legacy = str_repeat('l', 32);
        $this->writeSecret($this->legacyPath(), $legacy);

        $this->assertSame($legacy, $this->secretFile()->readBinary());
        $this->assertFileDoesNotExist($this->primaryPath());
    }

    public function test_reads_the_legacy_secret_when_the_primary_is_too_short(): void
    {
        $legacy = str_repeat('l', 32);
        $this->writeSecret($this->primaryPath(), 'short');
        $this->writeSecret($this->legacyPath(), $legacy);

        $this->assertSame($legacy, $this->secretFile()->readBinary());
    }

    public function test_has_no_secret_when_neither_file_is_usable(): void
    {
        $this->assertNull($this->secretFile()->readBinary());

        $this->writeSecret($this->primaryPath(), 'short');
        $this->writeSecret($this->legacyPath(), 'also short');

        $this->assertNull($this->secretFile()->readBinary());
    }

    public function test_password_stored_under_the_legacy_secret_still_decrypts(): void
    {
        $this->writeSecret($this->legacyPath(), random_bytes(32));
        $before = new MailDeliverySecretService($this->secretFile());
        $blob = $before->encrypt('smtp-password');

        $after = new MailDeliverySecretService($this->secretFile());

        $this->assertSame('smtp-password', $after->decrypt($blob));
        $this->assertSame(file_get_contents($this->legacyPath()), file_get_contents($this->primaryPath()));
    }

    private function secretFile(): MailDeliverySecretFile
    {
        return new MailDeliverySecretFile(app(WgwInstallConfig::class));
    }

    private function primaryPath(): string
    {
        return $this->root.'/data/drive/ui_auth_gate.secret';
    }

    private function legacyPath(): string
    {
        return $this->root.'/data/drive/drive_gate.secret';
    }

    private function writeSecret(string $path, string $contents): void
    {
        if (! is_dir(dirname($path))) {
            mkdir(dirname($path), 0775, true);
        }
        file_put_contents($path, $contents);
    }
}

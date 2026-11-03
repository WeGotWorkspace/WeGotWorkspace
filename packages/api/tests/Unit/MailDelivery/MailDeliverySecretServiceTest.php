<?php

declare(strict_types=1);

namespace Tests\Unit\MailDelivery;

use App\Services\MailDelivery\MailDeliverySecretFile;
use App\Services\MailDelivery\MailDeliverySecretService;
use App\Support\WgwInstallConfig;
use Tests\Support\UiDistFixture;
use Tests\TestCase;

final class MailDeliverySecretServiceTest extends TestCase
{
    private string $root = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/wgw-mail-delivery-crypt-'.uniqid('', true);
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

    public function test_round_trips_a_password(): void
    {
        $service = $this->service();

        $blob = $service->encrypt('smtp-password');

        $this->assertNotSame('smtp-password', $blob);
        $this->assertStringNotContainsString('smtp-password', (string) base64_decode($blob, true));
        $this->assertSame('smtp-password', $service->decrypt($blob));
    }

    public function test_an_empty_password_stays_empty_and_writes_no_secret(): void
    {
        $service = $this->service();

        $this->assertSame('', $service->encrypt(''));
        $this->assertSame('', $service->decrypt(''));
        $this->assertDirectoryDoesNotExist($this->root.'/data/drive');
    }

    public function test_decrypts_to_empty_when_the_secret_is_gone(): void
    {
        $blob = $this->service()->encrypt('smtp-password');
        unlink($this->root.'/data/drive/ui_auth_gate.secret');

        $this->assertSame('', $this->service()->decrypt($blob));
    }

    public function test_decrypts_to_empty_when_the_secret_changed(): void
    {
        $blob = $this->service()->encrypt('smtp-password');
        file_put_contents($this->root.'/data/drive/ui_auth_gate.secret', random_bytes(32));

        $this->assertSame('', $this->service()->decrypt($blob));
    }

    public function test_decrypts_to_empty_for_a_malformed_blob(): void
    {
        $service = $this->service();
        $service->encrypt('make the secret exist');

        $this->assertSame('', $service->decrypt('not base64 !'));
        $this->assertSame('', $service->decrypt(base64_encode(str_repeat('x', 28))));
    }

    public function test_decrypts_to_empty_for_a_tampered_blob(): void
    {
        $service = $this->service();
        $raw = (string) base64_decode($service->encrypt('smtp-password'), true);
        $raw[strlen($raw) - 1] = chr(ord($raw[strlen($raw) - 1]) ^ 1);

        $this->assertSame('', $service->decrypt(base64_encode($raw)));
    }

    private function service(): MailDeliverySecretService
    {
        return new MailDeliverySecretService(new MailDeliverySecretFile(app(WgwInstallConfig::class)));
    }
}

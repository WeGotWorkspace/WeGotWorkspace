<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Services\MailDelivery\MailDeliverySecretFile;
use App\Services\MailDelivery\MailDeliverySecretService;
use App\Support\DataDirSecretBox;
use App\Support\WgwInstallConfig;
use Tests\Support\UiDistFixture;
use Tests\TestCase;

final class DataDirSecretBoxTest extends TestCase
{
    private string $root = '';

    protected function setUp(): void
    {
        parent::setUp();

        $this->root = sys_get_temp_dir().'/wgw-secret-box-'.uniqid('', true);
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

    public function test_mail_delivery_label_matches_previous_key(): void
    {
        $box = $this->box();
        $box->encrypt('make the secret exist', 'x');
        $secret = (string) file_get_contents($this->root.'/data/drive/ui_auth_gate.secret');

        // The key the SMTP password used before the box was shared.
        $legacyKey = substr(hash('sha256', $secret.'|mail-delivery|smtp', true), 0, 32);
        $iv = random_bytes(12);
        $tag = '';
        $cipher = (string) openssl_encrypt('smtp-password', 'aes-256-gcm', $legacyKey, OPENSSL_RAW_DATA, $iv, $tag, '', 16);
        $legacyBlob = base64_encode($iv.$tag.$cipher);

        $this->assertSame('smtp-password', $box->decrypt($legacyBlob, MailDeliverySecretService::LABEL));
    }

    public function test_a_blob_does_not_decrypt_under_another_label(): void
    {
        $box = $this->box();
        $blob = $box->encrypt('mailbox-password', 'calendar-replies|imap');

        $this->assertSame('mailbox-password', $box->decrypt($blob, 'calendar-replies|imap'));
        $this->assertSame('', $box->decrypt($blob, MailDeliverySecretService::LABEL));
    }

    private function box(): DataDirSecretBox
    {
        return new DataDirSecretBox(new MailDeliverySecretFile(app(WgwInstallConfig::class)));
    }
}

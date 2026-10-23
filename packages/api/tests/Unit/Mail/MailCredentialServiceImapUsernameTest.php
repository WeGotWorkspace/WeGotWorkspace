<?php

declare(strict_types=1);

namespace Tests\Unit\Mail;

use App\Services\Mail\MailCredentialService;
use App\Services\MailDelivery\MailDeliverySecretFile;
use App\Support\WgwInstallConfig;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;

final class MailCredentialServiceImapUsernameTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $dataDir = storage_path('framework/testing/wgw-mail-cred-'.uniqid('', true));
        File::ensureDirectoryExists($dataDir);
        config(['wgw.data_dir' => $dataDir]);
        $this->app->forgetInstance(WgwInstallConfig::class);

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    public function test_save_stores_submitted_imap_username_independent_of_profile_email(): void
    {
        $service = new MailCredentialService(new MailDeliverySecretFile(
            $this->app->make(WgwInstallConfig::class)
        ));
        $service->save('alice', 'mailbox@provider.test', 'mail-secret');

        $account = $service->loadAccount('alice');
        $this->assertNotNull($account);
        $this->assertSame('mailbox@provider.test', $account['imapUsername']);
        $this->assertSame('mail-secret', $account['imapPassword']);
        $this->assertSame('mailbox@provider.test', $service->effectiveImapUsername('alice', $account));
    }

    public function test_effective_imap_username_falls_back_to_profile_email_when_unset(): void
    {
        $service = new MailCredentialService(new MailDeliverySecretFile(
            $this->app->make(WgwInstallConfig::class)
        ));

        $this->assertSame('alice@example.test', $service->effectiveImapUsername('alice', null));
    }
}

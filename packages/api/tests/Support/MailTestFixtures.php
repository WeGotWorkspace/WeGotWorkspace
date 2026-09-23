<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Mail\MailCredentialService;
use App\Services\Mail\MailOperationService;
use App\Services\Mail\MailSecretService;
use App\Support\WgwInstallConfig;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;

/**
 * Shared Mail API fixtures: bob, alice (admin), carol, mail servers, and credential helpers.
 */
trait MailTestFixtures
{
    use WgwRoleFixtures;

    protected string $mailDataDir = '';

    protected function setUpMailFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->mailDataDir = storage_path('framework/testing/wgw-mail-'.uniqid('', true));
        File::ensureDirectoryExists($this->mailDataDir.'/drive');
        config(['wgw.data_dir' => $this->mailDataDir]);
        $this->app->forgetInstance(WgwInstallConfig::class);

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSettings([
            'auth_realm' => 'SabreDAV',
            WgwSettings::MAIL_IMAP_HOST => '127.0.0.1',
            WgwSettings::MAIL_IMAP_PORT => 993,
            WgwSettings::MAIL_IMAP_SECURITY => 'ssl',
            WgwSettings::MAIL_SMTP_HOST => '127.0.0.1',
            WgwSettings::MAIL_SMTP_PORT => 587,
            WgwSettings::MAIL_SMTP_SECURITY => 'starttls',
        ]);

        $this->seedMailIdentity();
    }

    protected function tearDownMailFixtures(): void
    {
        set_time_limit(0);

        if ($this->mailDataDir !== '' && File::isDirectory($this->mailDataDir)) {
            File::deleteDirectory($this->mailDataDir);
        }
    }

    protected function seedMailIdentity(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
        $this->seedWgwUser('alice', email: 'alice@example.test', displayName: 'Alice');
        $this->seedWgwUser('carol', email: 'carol@example.test', displayName: 'Carol');

        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $teamGroup = $this->seedWgwGroup('principals/groups/team', 'Team');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);

        $this->addPrincipalToGroup($adminGroup, $alice);
        $this->addPrincipalToGroup($teamGroup, $bob);
        $this->addPrincipalToGroup($teamGroup, $alice);
    }

    protected function seedMailCredentials(
        string $username,
        string $imapUsername,
        string $imapPassword,
        array $endpoints = [],
    ): void {
        $service = new MailCredentialService(new MailSecretService(
            $this->app->make(WgwInstallConfig::class)
        ));
        $service->saveAccount($username, array_merge([
            'imapUsername' => $imapUsername,
            'imapPassword' => $imapPassword,
            'imapHost' => '127.0.0.1',
            'imapPort' => 993,
            'imapSecurity' => 'ssl',
            'smtpHost' => '127.0.0.1',
            'smtpPort' => 587,
            'smtpSecurity' => 'starttls',
        ], $endpoints));
    }

    public function seedFixtureMailbox(string $username = 'bob', ?string $imapUsername = null): void
    {
        $this->seedMailCredentials(
            $username,
            $imapUsername ?? ImapFixture::username(),
            ImapFixture::password(),
            ImapFixture::endpoints($imapUsername ?? ImapFixture::username()),
        );
    }

    protected function inboxFolderToken(): string
    {
        return MailOperationService::folderIdEncode('INBOX');
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function clearMailServerSettings(): void
    {
        $this->setAppSettings([
            WgwSettings::MAIL_IMAP_HOST => '',
            WgwSettings::MAIL_SMTP_HOST => '',
        ]);
    }
}

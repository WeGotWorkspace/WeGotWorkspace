<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Support\WgwInstallConfig;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\File;

/**
 * Shared Settings API fixtures: bob, alice (admin), carol, mail servers, and team group.
 */
trait SettingsTestFixtures
{
    use WgwRoleFixtures;

    private string $settingsDataDir = '';

    protected function setUpSettingsFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->settingsDataDir = storage_path('framework/testing/wgw-settings-'.uniqid('', true));
        File::ensureDirectoryExists($this->settingsDataDir.'/drive');
        config(['wgw.data_dir' => $this->settingsDataDir]);
        $this->app->forgetInstance(WgwInstallConfig::class);

        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSettings([
            'auth_realm' => 'SabreDAV',
            WgwSettings::MAIL_SMTP_HOST => 'smtp.example.test',
            WgwSettings::MAIL_SMTP_PORT => 587,
            WgwSettings::MAIL_SMTP_SECURITY => 'starttls',
        ]);

        $this->seedSettingsIdentity();
    }

    protected function tearDownSettingsFixtures(): void
    {
        if ($this->settingsDataDir !== '' && File::isDirectory($this->settingsDataDir)) {
            File::deleteDirectory($this->settingsDataDir);
        }
    }

    protected function seedSettingsIdentity(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', email: 'bob@example.test', displayName: 'Bob');
        $this->seedWgwUser('alice', email: 'alice@example.test', displayName: 'Alice');
        $this->seedWgwUser('carol', email: 'carol@example.test', displayName: 'Carol');

        $adminGroup = $this->seedWgwGroup(AdminRoleResolver::ADMIN_GROUP_URI, 'Administrators');
        $teamGroup = $this->seedWgwGroup('principals/groups/team', 'Team');
        $supportGroup = $this->seedWgwGroup('principals/groups/support', 'Support');

        $alice = Principal::forUsername('alice');
        $bob = Principal::forUsername('bob');
        $carol = Principal::forUsername('carol');
        $this->assertNotNull($alice);
        $this->assertNotNull($bob);
        $this->assertNotNull($carol);

        $this->addPrincipalToGroup($adminGroup, $alice);
        $this->addPrincipalToGroup($teamGroup, $bob);
        $this->addPrincipalToGroup($teamGroup, $alice);
        $this->addPrincipalToGroup($supportGroup, $bob);
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }
}

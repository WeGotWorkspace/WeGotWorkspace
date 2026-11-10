<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use Illuminate\Support\Facades\File;

/**
 * Shared disk + identity fixtures for Admin API feature tests.
 */
trait AdminTestFixtures
{
    use WgwRoleFixtures;

    private string $adminDataDir = '';

    private bool $adminFixturesUseAppRoot = false;

    protected function setUpAdminFixtures(bool $withAppRoot = false): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->adminDataDir = storage_path('framework/testing/wgw-admin-'.uniqid('', true));
        File::ensureDirectoryExists($this->adminDataDir.'/updates/backup');
        File::ensureDirectoryExists($this->adminDataDir.'/files/users/bob');
        File::ensureDirectoryExists($this->adminDataDir.'/files/users/alice');
        File::ensureDirectoryExists($this->adminDataDir.'/files/users/carol');

        $this->adminFixturesUseAppRoot = $withAppRoot;
        if ($withAppRoot) {
            File::ensureDirectoryExists($this->adminDataDir.'/install-root');
            WgwInstallFixture::bindInstallRoot($this->adminDataDir.'/install-root');
        }

        WgwTestDisks::refresh($this->adminDataDir);
        $this->configureWgwJwtKeys();
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->setAppSetting('auth_realm', 'SabreDAV');
        $this->seedAdminRoleMatrix();
    }

    protected function tearDownAdminFixtures(): void
    {
        if ($this->adminDataDir !== '' && File::isDirectory($this->adminDataDir)) {
            File::deleteDirectory($this->adminDataDir);
        }
    }

    protected function seedAdminRoleMatrix(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob', email: 'bob@example.test');
        $this->seedWgwUser('alice', displayName: 'Alice', email: 'alice@example.test');
        $this->seedWgwUser('carol', displayName: 'Carol', email: 'carol@example.test');

        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $adminGroup = $this->seedWgwGroup(LegacyAdministratorsTeam::URI, 'Administrators');
        $this->addPrincipalToGroup($adminGroup, $alice);
        $this->grantAdminRole($alice);
    }

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function adminDataDirectory(): string
    {
        return $this->adminDataDir;
    }
}

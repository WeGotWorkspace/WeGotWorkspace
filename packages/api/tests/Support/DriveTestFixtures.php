<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Auth\AdminRoleResolver;
use App\Services\Drive\DriveService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Illuminate\Testing\TestResponse;

/**
 * Shared Drive API fixtures: bob, alice (admin), carol, and team group drive.
 */
trait DriveTestFixtures
{
    use WgwRoleFixtures;

    private string $driveDataDir = '';

    protected function setUpDriveFixtures(): void
    {
        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->driveDataDir = storage_path('framework/testing/wgw-drive-'.uniqid('', true));
        foreach (['bob', 'alice', 'carol'] as $username) {
            File::ensureDirectoryExists($this->driveDataDir.'/files/users/'.$username);
        }
        File::ensureDirectoryExists($this->driveDataDir.'/files/groups/team');
        WgwTestDisks::refresh($this->driveDataDir);

        $this->configureWgwJwtKeys();
        $this->seedDriveIdentity();
    }

    protected function tearDownDriveFixtures(): void
    {
        if ($this->driveDataDir !== '' && File::isDirectory($this->driveDataDir)) {
            File::deleteDirectory($this->driveDataDir);
        }
    }

    protected function seedDriveIdentity(): void
    {
        if (User::query()->where('username', 'bob')->exists()) {
            return;
        }

        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('carol', displayName: 'Carol');

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

    protected function carolBearerToken(): string
    {
        return $this->issueBearerTokenFor('carol');
    }

    protected function assertAccessDenied(TestResponse $response): void
    {
        $response->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }

    protected function assertSearchDocumentExists(string $sourceKey): void
    {
        $this->assertNotNull(
            DB::connection('wgw')->table('search_documents')
                ->where('source_type', 'file')
                ->where('source_key', $sourceKey)
                ->first(),
            "Expected search index row for {$sourceKey}"
        );
    }

    protected function assertSearchDocumentMissing(string $sourceKey): void
    {
        $this->assertNull(
            DB::connection('wgw')->table('search_documents')
                ->where('source_type', 'file')
                ->where('source_key', $sourceKey)
                ->first(),
            "Expected no search index row for {$sourceKey}"
        );
    }

    /**
     * @return array{username: string, role: string}
     */
    protected function drivePrincipal(string $username): array
    {
        return [
            'username' => $username,
            'role' => $username === 'alice' ? 'admin' : 'user',
        ];
    }

    /**
     * @return array{username: string, role: string}
     */
    protected function drivePrincipalForPath(string $parentPath): array
    {
        $username = 'bob';
        if (preg_match('#^/users/([^/]+)#', $parentPath, $matches) === 1) {
            $username = $matches[1];
        }

        return $this->drivePrincipal($username);
    }

    protected function createDriveDirectory(string $parentPath, string $name): void
    {
        $result = app(DriveService::class)->createItem(
            $this->drivePrincipalForPath($parentPath),
            $name,
            'dir',
            $parentPath,
        );
        $this->assertSame('Created', $result);
    }

    protected function createDriveFile(string $token, string $parentPath, string $name): void
    {
        $this->assertNotSame('', $token);
        $result = app(DriveService::class)->createItem(
            $this->drivePrincipalForPath($parentPath),
            $name,
            'file',
            $parentPath,
        );
        $this->assertSame('Created', $result);
    }

    protected function ensureTrashDirectory(string $token, string $username): void
    {
        $this->assertNotSame('', $token);
        $disk = app(WgwStorage::class)->files();
        $key = 'users/'.$username.'/.Trash';
        if ($disk->directoryExists($key)) {
            return;
        }
        $result = app(DriveService::class)->createItem(
            $this->drivePrincipal($username),
            '.Trash',
            'dir',
            '/users/'.$username,
        );
        $this->assertSame('Created', $result);
    }

    protected function seedPrivateFile(string $username, string $filename, string $content = 'content'): string
    {
        app(WgwStorage::class)->files()->put('users/'.$username.'/'.$filename, $content);

        return '/users/'.$username.'/'.$filename;
    }

    protected function seedGroupFile(string $filename, string $content = 'content'): string
    {
        app(WgwStorage::class)->files()->put('groups/team/'.$filename, $content);

        return '/groups/team/'.$filename;
    }
}

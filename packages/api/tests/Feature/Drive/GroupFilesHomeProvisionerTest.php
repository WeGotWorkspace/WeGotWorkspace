<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Drive\GroupFilesHomeProvisioner;
use App\Services\Installer\InstallerSeeder;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class GroupFilesHomeProvisionerTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = storage_path('framework/testing/wgw-group-drive-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files');
        WgwTestDisks::refresh($this->dataDir);
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }
        parent::tearDown();
    }

    public function test_backfill_creates_missing_group_drives_and_skips_the_container(): void
    {
        $this->seedWgwGroup('principals/groups', 'Groups');
        $this->seedWgwGroup('principals/groups/legacy-team', 'Legacy Team');
        $this->seedWgwGroup('principals/groups/kept', 'Kept');
        $this->seedWgwGroup('principals/groups/nested/nope', 'Nested');
        File::ensureDirectoryExists($this->dataDir.'/files/groups/kept');

        $result = app(GroupFilesHomeProvisioner::class)->ensureForAllGroupPrincipals();

        $this->assertSame(2, $result['scanned']);
        $this->assertSame(1, $result['created']);
        $this->assertSame(1, $result['skipped']);
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/legacy-team'));
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/kept'));
        $this->assertFalse(is_dir($this->dataDir.'/files/groups/nested'));
        $this->assertFalse(is_dir($this->dataDir.'/files/groups/nope'));

        $second = app(GroupFilesHomeProvisioner::class)->ensureForAllGroupPrincipals();
        $this->assertSame(2, $second['scanned']);
        $this->assertSame(0, $second['created']);
        $this->assertSame(2, $second['skipped']);
    }

    public function test_installer_seed_creates_administrators_drive(): void
    {
        app(InstallerSeeder::class)->seed(
            'drive-admin',
            'longpassword',
            'Drive Admin',
            'drive-admin@example.test',
            false,
            false,
        );

        $this->assertTrue(is_dir($this->dataDir.'/files/groups/administrators'));
        $this->assertFalse(is_dir($this->dataDir.'/files/groups/administrators/.notes'));
    }
}

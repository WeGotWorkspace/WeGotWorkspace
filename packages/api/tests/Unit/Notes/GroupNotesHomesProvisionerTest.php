<?php

declare(strict_types=1);

namespace Tests\Unit\Notes;

use App\Services\Installer\InstallerSeeder;
use App\Services\Notes\GroupNotesHomesProvisioner;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class GroupNotesHomesProvisionerTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = storage_path('framework/testing/wgw-group-notes-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/groups');
        WgwTestDisks::refresh($this->dataDir);
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }
        parent::tearDown();
    }

    public function test_ensure_for_slug_creates_group_home_and_notes_when_absent(): void
    {
        $provisioner = app(GroupNotesHomesProvisioner::class);

        $created = $provisioner->ensureForSlug('engineering');

        $this->assertTrue($created);
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/engineering'));
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/engineering/.notes'));
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/engineering/.notes/General'));
    }

    public function test_ensure_for_slug_second_run_does_not_mutate_existing_notes_mtime(): void
    {
        $notesPath = $this->dataDir.'/files/groups/ops/.notes';
        File::ensureDirectoryExists($notesPath);
        $stale = time() - 30;
        touch($notesPath, $stale);
        clearstatcache(true, $notesPath);
        $mtimeBefore = filemtime($notesPath);
        $this->assertNotFalse($mtimeBefore);
        $this->assertSame($stale, $mtimeBefore);

        $created = app(GroupNotesHomesProvisioner::class)->ensureForSlug('ops');

        clearstatcache(true, $notesPath);
        $mtimeAfter = filemtime($notesPath);

        $this->assertFalse($created);
        $this->assertSame($mtimeBefore, $mtimeAfter);
    }

    public function test_ensure_for_all_group_homes_creates_only_when_absent(): void
    {
        File::ensureDirectoryExists($this->dataDir.'/files/groups/alpha');
        File::ensureDirectoryExists($this->dataDir.'/files/groups/beta/.notes');
        file_put_contents($this->dataDir.'/files/groups/readme.txt', 'skip me');

        $betaNotes = $this->dataDir.'/files/groups/beta/.notes';
        $stale = time() - 30;
        touch($betaNotes, $stale);
        clearstatcache(true, $betaNotes);
        $mtimeBefore = filemtime($betaNotes);
        $this->assertNotFalse($mtimeBefore);
        $this->assertSame($stale, $mtimeBefore);

        $result = app(GroupNotesHomesProvisioner::class)->ensureForAllGroupHomes();

        clearstatcache(true, $betaNotes);

        $this->assertSame(2, $result['scanned']);
        $this->assertSame(1, $result['created']);
        $this->assertSame(1, $result['skipped']);
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/alpha/.notes'));
        $this->assertTrue(is_dir($this->dataDir.'/files/groups/alpha/.notes/General'));
        // Existing `.notes` homes are not mutated (no default notebook mkdir / mtime bump).
        $this->assertFalse(is_dir($this->dataDir.'/files/groups/beta/.notes/General'));
        $this->assertSame($mtimeBefore, filemtime($betaNotes));

        $second = app(GroupNotesHomesProvisioner::class)->ensureForAllGroupHomes();
        $this->assertSame(2, $second['scanned']);
        $this->assertSame(0, $second['created']);
        $this->assertSame(2, $second['skipped']);
    }

    public function test_installer_seed_creates_administrators_notes_home(): void
    {
        app(InstallerSeeder::class)->seed(
            'notes-admin',
            'longpassword',
            'Notes Admin',
            'notes-admin@example.test',
            false,
            false,
        );

        $this->assertFalse(is_dir($this->dataDir.'/files/groups/administrators/.notes'));
    }
}

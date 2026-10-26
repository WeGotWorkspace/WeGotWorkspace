<?php

declare(strict_types=1);

namespace Tests\Architecture;

use PHPUnit\Framework\TestCase;

/**
 * Documents suite write/observation contracts for the notify pipeline (#741).
 */
final class WritePathContractTest extends TestCase
{
    public function test_calendar_contacts_notes_tasks_do_not_write_drive_disk(): void
    {
        $roots = [
            $this->appPath('Services/Calendars'),
            $this->appPath('Services/Contacts'),
            $this->appPath('Services/Notes'),
            $this->appPath('Services/Tasks'),
        ];
        $violations = [];
        foreach ($this->phpFiles($roots) as $file) {
            $base = basename($file);
            if (! str_ends_with($base, 'Repository.php')) {
                continue;
            }
            $content = (string) file_get_contents($file);
            if (str_contains($content, 'WgwStorage')
                || preg_match('/Storage::disk\(/', $content) === 1
                || str_contains($content, 'DriveService')
            ) {
                $violations[] = $this->rel($file);
            }
        }

        $this->assertSame(
            [],
            $violations,
            "Calendar/Contacts/Notes/Tasks must mutate via CalPDO/CardPDO, not Drive:\n".implode("\n", $violations)
        );
    }

    public function test_calendar_contacts_notes_tasks_use_caldav_or_carddav_backends(): void
    {
        $pairs = [
            'Services/Calendars/CalendarEventMutationSupport.php' => 'Sabre\\CalDAV\\Backend\\PDO',
            'Services/Tasks/TaskRepository.php' => 'Sabre\\CalDAV\\Backend\\PDO',
            'Services/Notes/NoteRepository.php' => 'Sabre\\CalDAV\\Backend\\PDO',
            'Services/Contacts/ContactCardRepository.php' => 'Sabre\\CardDAV\\Backend\\PDO',
        ];
        foreach ($pairs as $rel => $backend) {
            $path = $this->appPath($rel);
            $this->assertFileExists($path);
            $this->assertStringContainsString(
                $backend,
                (string) file_get_contents($path),
                $rel.' must use '.$backend
            );
        }
    }

    public function test_drive_disk_io_goes_through_wgw_storage_files(): void
    {
        $wgwStorage = (string) file_get_contents($this->appPath('Storage/WgwStorage.php'));
        $this->assertStringContainsString('function files()', $wgwStorage);
        $this->assertStringContainsString("Storage::disk('wgw_files')", $wgwStorage);

        $roots = [
            $this->appPath('Services/Drive'),
            $this->appPath('Services/Jmap/FileNodes'),
            $this->appPath('Services/Collab'),
        ];
        $violations = [];
        foreach ($this->phpFiles($roots) as $file) {
            $content = (string) file_get_contents($file);
            if (preg_match("/Storage::disk\(\s*['\"]wgw_files['\"]/", $content) === 1) {
                $violations[] = $this->rel($file);
            }
        }

        $this->assertSame(
            [],
            $violations,
            "Drive writers must use WgwStorage::files(), not Storage::disk('wgw_files'):\n".implode("\n", $violations)
        );
    }

    public function test_drive_observation_has_one_hook(): void
    {
        $index = $this->appPath('Services/Jmap/FileNodes/FileNodeIndexService.php');
        $jmap = $this->appPath('Services/Jmap/FileNodes/FileNodeSetService.php');
        $drive = $this->appPath('Services/Drive/DriveService.php');
        $relocator = $this->appPath('Services/Jmap/FileNodes/FileNodeRelocator.php');
        $dav = $this->appPath('Dav/Server/FileNodeIndexPlugin.php');

        $this->assertFileExists($index);
        $this->assertFileExists($jmap);
        $this->assertFileExists($drive);
        $this->assertFileExists($relocator);
        $this->assertFileExists($dav);

        $indexSrc = (string) file_get_contents($index);
        $this->assertStringContainsString('function syncSearch', $indexSrc);
        $this->assertStringContainsString('indexFileStorageKey', $indexSrc);

        foreach ([$jmap, $drive, $relocator] as $path) {
            $src = (string) file_get_contents($path);
            $this->assertStringNotContainsString('indexFileStorageKey', $src, $path);
            $this->assertStringNotContainsString('deleteDavPath', $src, $path);
        }

        $jmapSrc = (string) file_get_contents($jmap);
        $this->assertStringContainsString('WgwStorage', $jmapSrc);

        $driveSrc = (string) file_get_contents($drive);
        $this->assertStringContainsString('function disk()', $driveSrc);

        $davSrc = (string) file_get_contents($dav);
        $this->assertStringContainsString('afterMethod:', $davSrc);
        $this->assertStringContainsString('afterWriteMethod', $davSrc);
    }

    /**
     * Move and delete bookkeeping for Drive paths has one home (#1612): every
     * write surface calls DrivePathBookkeeping, and nothing else re-points
     * or drops docs threads, index sidecars, stars or share paths itself.
     */
    public function test_drive_move_and_delete_bookkeeping_has_one_entry_point(): void
    {
        $bookkeeping = $this->appPath('Services/Drive/DrivePathBookkeeping.php');
        $this->assertFileExists($bookkeeping);

        foreach ([
            'Services/Drive/DriveService.php',
            'Services/Jmap/FileNodes/FileNodeRelocator.php',
            'Dav/Server/FileNodeIndexPlugin.php',
        ] as $caller) {
            $this->assertStringContainsString(
                'DrivePathBookkeeping',
                (string) file_get_contents($this->appPath($caller)),
                $caller.' must hand its move and delete bookkeeping to DrivePathBookkeeping',
            );
        }

        $patterns = [
            '->retargetPath(',
            '->dropPath(',
            '->recordMoveWithSidecar(',
            '->recordDeleteWithSidecar(',
            '->deletePathPrefix(',
            '->destroyDocsBestEffort(',
            '->relocateAfterMoveBestEffort(',
        ];
        $violations = [];
        foreach ($this->phpFiles([dirname(__DIR__, 2).'/app']) as $file) {
            if ($file === $bookkeeping) {
                continue;
            }
            $src = (string) file_get_contents($file);
            foreach ($patterns as $pattern) {
                if (str_contains($src, $pattern)) {
                    $violations[] = $this->rel($file).': '.$pattern;
                }
            }
        }

        $this->assertSame([], $violations, "Call DrivePathBookkeeping instead:\n".implode("\n", $violations));
    }

    private function appPath(string $relative): string
    {
        return dirname(__DIR__, 2).'/app/'.$relative;
    }

    private function rel(string $file): string
    {
        return str_replace(dirname(__DIR__, 2).'/', '', $file);
    }

    /**
     * @param  list<string>  $roots
     * @return list<string>
     */
    private function phpFiles(array $roots): array
    {
        $files = [];
        foreach ($roots as $root) {
            if (! is_dir($root)) {
                continue;
            }
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($root, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($iterator as $file) {
                if ($file->isFile() && str_ends_with($file->getFilename(), '.php')) {
                    $files[] = $file->getPathname();
                }
            }
        }

        return $files;
    }
}

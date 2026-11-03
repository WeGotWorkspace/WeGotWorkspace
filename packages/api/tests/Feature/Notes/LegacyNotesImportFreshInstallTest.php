<?php

declare(strict_types=1);

namespace Tests\Feature\Notes;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * A fresh install runs every migration before its first user exists, while
 * the storage disks still point at the default data directory inside the
 * document root. The legacy notes import has nothing to do then and must not
 * touch the files disk (#1803).
 */
final class LegacyNotesImportFreshInstallTest extends WgwDatabaseTestCase
{
    private const MIGRATION = 'migrations/wgw/2026_10_29_000770_wgw_import_legacy_markdown_notes.php';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();
        $this->dataDir = storage_path('framework/testing/wgw-fresh-install-'.uniqid('', true));
        WgwTestDisks::refresh($this->dataDir);
        DB::connection('wgw')->table('users')->delete();
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->dataDir);
        parent::tearDown();
    }

    public function test_the_import_leaves_the_files_disk_alone_before_the_first_user(): void
    {
        $migration = require database_path(self::MIGRATION);
        $migration->up();

        $this->assertDirectoryDoesNotExist($this->dataDir.'/files');
    }
}

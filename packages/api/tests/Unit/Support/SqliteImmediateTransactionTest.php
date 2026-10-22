<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\WgwConnectionConfigurator;
use Illuminate\Support\Facades\DB;
use PDO;
use PDOException;
use Tests\TestCase;

/**
 * A note PATCH reads (ETag check) and then writes inside one transaction. On
 * SQLite a deferred transaction only takes the write lock at its first write,
 * so two requests at once (a create and its first save) ended in "database is
 * locked" (HTTP 500) instead of one waiting for the other. An immediate
 * transaction takes the write lock at BEGIN, so the second writer waits.
 */
final class SqliteImmediateTransactionTest extends TestCase
{
    public function test_the_wgw_connection_config_starts_immediate_transactions(): void
    {
        $connections = (require base_path('config/database.php'))['connections'];

        $this->assertSame('IMMEDIATE', $connections['wgw']['transaction_mode']);
        $this->assertSame('IMMEDIATE', $connections['sqlite']['transaction_mode']);
    }

    public function test_an_installer_sqlite_transaction_holds_the_write_lock_from_begin(): void
    {
        $path = sys_get_temp_dir().'/wgw-immediate-'.uniqid('', true).'.sqlite';
        touch($path);

        try {
            WgwConnectionConfigurator::applyFromInstallerDb(['driver' => 'sqlite', 'sqlite_path' => $path]);
            $connection = DB::connection('wgw');
            $connection->statement('create table probe (id integer)');

            $connection->beginTransaction();
            $connection->select('select count(*) from probe');

            $other = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_TIMEOUT => 0]);
            $other->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $lockedOut = false;
            try {
                $other->exec('BEGIN IMMEDIATE');
            } catch (PDOException) {
                $lockedOut = true;
            }

            $this->assertTrue($lockedOut, 'A second writer got the lock while a transaction was open.');
            $connection->rollBack();
        } finally {
            DB::purge('wgw');
            @unlink($path);
        }
    }
}

<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Database\WgwSqliteConnection;
use App\Support\WgwConnectionConfigurator;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use PDO;
use PDOException;
use Tests\TestCase;

/**
 * A note PATCH reads (ETag check) and then writes inside one transaction. On
 * SQLite a deferred transaction only takes the write lock at its first write,
 * so two requests at once (a create and its first save) ended in "database is
 * locked" (HTTP 500) instead of one waiting for the other. An immediate
 * transaction takes the write lock at BEGIN, and the busy timeout lets the
 * second writer wait for it instead of failing at once.
 */
final class SqliteImmediateTransactionTest extends TestCase
{
    public function test_the_wgw_connection_config_starts_immediate_transactions(): void
    {
        $connections = (require base_path('config/database.php'))['connections'];

        $this->assertSame('IMMEDIATE', $connections['wgw']['transaction_mode']);
        $this->assertSame('IMMEDIATE', $connections['sqlite']['transaction_mode']);
        $this->assertSame(5000, $connections['wgw']['busy_timeout']);
        $this->assertSame(5000, $connections['sqlite']['busy_timeout']);
        $this->assertSame('wal', $connections['wgw']['journal_mode']);
    }

    public function test_an_installer_sqlite_connection_waits_for_the_write_lock(): void
    {
        $path = sys_get_temp_dir().'/wgw-busy-'.uniqid('', true).'.sqlite';
        touch($path);
        $previous = config('database.connections.wgw');

        try {
            WgwConnectionConfigurator::applyFromInstallerDb(['driver' => 'sqlite', 'sqlite_path' => $path]);

            $this->assertSame(5000, config('database.connections.wgw.busy_timeout'));
        } finally {
            DB::purge('wgw');
            config(['database.connections.wgw' => $previous]);
            @unlink($path);
        }
    }

    public function test_an_installer_sqlite_transaction_holds_the_write_lock_from_begin(): void
    {
        $path = sys_get_temp_dir().'/wgw-immediate-'.uniqid('', true).'.sqlite';
        touch($path);
        // Later tests in this process must keep the wgw connection they had.
        $previous = config('database.connections.wgw');

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
            config(['database.connections.wgw' => $previous]);
            @unlink($path);
        }
    }

    public function test_the_php_83_fallback_takes_the_write_lock_at_begin(): void
    {
        $path = sys_get_temp_dir().'/wgw-fallback-'.uniqid('', true).'.sqlite';
        touch($path);
        $previous = config('database.connections.wgw');

        try {
            WgwConnectionConfigurator::applyFromInstallerDb(['driver' => 'sqlite', 'sqlite_path' => $path]);
            $connection = DB::connection('wgw');
            $this->assertInstanceOf(WgwSqliteConnection::class, $connection);
            $connection->statement('create table probe (id integer)');

            // The path PHP 8.3 takes, run directly so it is covered on every PHP.
            $connection->beginWithWriteLock();

            $other = new PDO('sqlite:'.$path, null, null, [PDO::ATTR_TIMEOUT => 0]);
            $other->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $lockedOut = false;
            try {
                $other->exec('BEGIN IMMEDIATE');
            } catch (PDOException) {
                $lockedOut = true;
            }

            $this->assertTrue($lockedOut, 'A second writer got the lock while a transaction was open.');
            $connection->getPdo()->rollBack();
        } finally {
            DB::purge('wgw');
            config(['database.connections.wgw' => $previous]);
            @unlink($path);
        }
    }

    /**
     * #2157: the PHP 8.3 path read user_version inside the transaction, so it
     * held a read lock before it asked for the write lock. SQLite does not
     * wait for that upgrade: with another writer active it failed at once,
     * busy timeout or not. Now it waits for the other writer to finish.
     */
    public function test_the_php_83_fallback_waits_for_another_writer_instead_of_failing(): void
    {
        $this->withSqliteFile(function (string $path): void {
            $connection = DB::connection('wgw');
            $this->assertInstanceOf(WgwSqliteConnection::class, $connection);
            $connection->statement('create table probe (id integer)');

            $holder = $this->holdWriteLock($path, 600);
            $started = microtime(true);
            try {
                $connection->beginWithWriteLock();
                $connection->getPdo()->exec('insert into probe values (1)');
                $connection->getPdo()->commit();
            } finally {
                $this->release($holder);
            }

            $this->assertGreaterThan(0.2, microtime(true) - $started, 'It did not wait for the other writer.');
            $this->assertSame(1, (int) $connection->scalar('select count(*) from probe'));
        });
    }

    public function test_a_statement_outside_a_transaction_is_retried_when_the_database_is_busy(): void
    {
        $this->withSqliteFile(function (string $path): void {
            // A short busy timeout, so the first try gives up while the other
            // writer still holds the lock and a retry has to finish the job.
            config(['database.connections.wgw.busy_timeout' => 100]);
            DB::purge('wgw');
            $connection = DB::connection('wgw');
            $connection->statement('create table probe (id integer)');

            $holder = $this->holdWriteLock($path, 250);
            try {
                $connection->insert('insert into probe values (1)');
            } finally {
                $this->release($holder);
            }

            $this->assertSame(1, (int) $connection->scalar('select count(*) from probe'));
        }, busyTimeout: 100);
    }

    public function test_a_statement_inside_a_transaction_is_not_retried(): void
    {
        $this->withSqliteFile(function (string $path): void {
            $connection = DB::connection('wgw');
            $connection->statement('create table probe (id integer)');

            // A deferred transaction (never what the app uses) that already
            // read: its first write needs the lock another writer holds.
            $connection->getPdo()->beginTransaction();
            (new \ReflectionProperty($connection, 'transactions'))->setValue($connection, 1);
            $connection->select('select count(*) from probe');
            $holder = $this->holdWriteLock($path, 400);
            try {
                $connection->insert('insert into probe values (1)');
                $this->fail('The write inside the transaction should have failed.');
            } catch (QueryException $exception) {
                $this->assertTrue(WgwSqliteConnection::isBusy($exception));
            } finally {
                $connection->getPdo()->rollBack();
                (new \ReflectionProperty($connection, 'transactions'))->setValue($connection, 0);
                $this->release($holder);
            }
        });
    }

    public function test_an_existing_rollback_journal_database_switches_to_wal_on_connect(): void
    {
        $path = sys_get_temp_dir().'/wgw-wal-'.uniqid('', true).'.sqlite';
        $legacy = new PDO('sqlite:'.$path);
        $legacy->exec('PRAGMA journal_mode = DELETE');
        $legacy->exec('create table probe (id integer)');
        $legacy = null;

        $this->withSqliteFile(function (string $path): void {
            $this->assertSame('wal', DB::connection('wgw')->scalar('PRAGMA journal_mode'));
        }, path: $path);

        // Stored in the file: a plain connection sees it too.
        $this->assertSame('wal', (new PDO('sqlite:'.$path))->query('PRAGMA journal_mode')->fetchColumn());
        $this->removeSqliteFiles($path);
    }

    public function test_a_database_that_cannot_switch_now_keeps_working_and_switches_later(): void
    {
        $path = sys_get_temp_dir().'/wgw-wal-busy-'.uniqid('', true).'.sqlite';
        $legacy = new PDO('sqlite:'.$path);
        $legacy->exec('PRAGMA journal_mode = DELETE');
        $legacy->exec('create table probe (id integer)');
        $legacy->exec('insert into probe values (1)');
        // An open read keeps the database from switching (it needs a moment alone).
        $legacy->beginTransaction();
        $legacy->query('select count(*) from probe')->fetchAll();

        $this->withSqliteFile(function (): void {
            $connection = DB::connection('wgw');
            $this->assertSame(1, (int) $connection->scalar('select count(*) from probe'));
            $this->assertSame('delete', $connection->scalar('PRAGMA journal_mode'));
        }, path: $path, busyTimeout: 50);

        $legacy->rollBack();
        $legacy = null;
        $this->withSqliteFile(function (): void {
            $this->assertSame('wal', DB::connection('wgw')->scalar('PRAGMA journal_mode'));
        }, path: $path);
        $this->removeSqliteFiles($path);
    }

    /**
     * Run $callback with the wgw connection on a SQLite file, then restore it.
     *
     * @param  callable(string): void  $callback
     */
    private function withSqliteFile(callable $callback, ?string $path = null, ?int $busyTimeout = null): void
    {
        $owned = $path === null;
        $path ??= sys_get_temp_dir().'/wgw-lock-'.uniqid('', true).'.sqlite';
        if (! is_file($path)) {
            touch($path);
        }
        $previous = config('database.connections.wgw');

        try {
            WgwConnectionConfigurator::applyFromInstallerDb(['driver' => 'sqlite', 'sqlite_path' => $path]);
            if ($busyTimeout !== null) {
                config(['database.connections.wgw.busy_timeout' => $busyTimeout]);
                DB::purge('wgw');
            }
            $callback($path);
        } finally {
            DB::purge('wgw');
            config(['database.connections.wgw' => $previous]);
            if ($owned) {
                $this->removeSqliteFiles($path);
            }
        }
    }

    /**
     * Another process takes the write lock and keeps it for $holdMs. Returns
     * once the lock is held.
     *
     * @return array{0: resource, 1: array<int, resource>}
     */
    private function holdWriteLock(string $path, int $holdMs): array
    {
        $script = sprintf(
            '$p = new PDO(%s); $p->exec("BEGIN IMMEDIATE"); $p->exec("insert into probe values (0)"); fwrite(STDOUT, "locked\n"); usleep(%d); $p->exec("ROLLBACK");',
            var_export('sqlite:'.$path, true),
            $holdMs * 1000,
        );
        $process = proc_open([PHP_BINARY, '-r', $script], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        $this->assertIsResource($process);
        $line = fgets($pipes[1]);
        if ($line !== "locked\n") {
            // Only now: reading stderr waits for the process to end.
            $this->fail('The lock holder did not start: '.stream_get_contents($pipes[2]));
        }

        return [$process, $pipes];
    }

    /**
     * @param  array{0: resource, 1: array<int, resource>}  $holder
     */
    private function release(array $holder): void
    {
        [$process, $pipes] = $holder;
        foreach ($pipes as $pipe) {
            fclose($pipe);
        }
        proc_close($process);
    }

    private function removeSqliteFiles(string $path): void
    {
        foreach (['', '-wal', '-shm', '-journal'] as $suffix) {
            @unlink($path.$suffix);
        }
    }
}

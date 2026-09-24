<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

final class WgwConnectionConfigurator
{
    /**
     * @param  array<string, mixed>  $db
     */
    public static function applyFromInstallerDb(array $db): void
    {
        $driver = (string) ($db['driver'] ?? 'sqlite');

        if ($driver === 'mysql') {
            config([
                'database.connections.wgw' => [
                    'driver' => 'mysql',
                    'host' => (string) ($db['mysql_host'] ?? '127.0.0.1'),
                    'port' => (string) ((int) ($db['mysql_port'] ?? 3306)),
                    'database' => (string) ($db['mysql_db'] ?? ''),
                    'username' => (string) ($db['mysql_user'] ?? ''),
                    'password' => (string) ($db['mysql_password'] ?? ''),
                    'charset' => 'utf8mb4',
                    'collation' => 'utf8mb4_unicode_ci',
                    'prefix' => '',
                    'prefix_indexes' => true,
                    'strict' => true,
                    'engine' => null,
                    'options' => wgw_mysql_pdo_options(),
                    'foreign_key_constraints' => true,
                ],
            ]);
            DB::purge('wgw');

            return;
        }

        $paths = app(AppPaths::class);
        $path = $paths->resolveProjectPath((string) ($db['sqlite_path'] ?? $paths->defaultSqliteRelativePath()));

        config([
            'database.connections.wgw' => [
                'driver' => 'sqlite',
                'database' => $path,
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);
        DB::purge('wgw');
    }

    public static function applyFromPdo(\PDO $pdo): void
    {
        $driver = (string) $pdo->getAttribute(\PDO::ATTR_DRIVER_NAME);

        if ($driver === 'mysql') {
            self::applyMysqlFromPdo($pdo);

            return;
        }

        if ($driver === 'sqlite') {
            self::applySqliteFromPdo($pdo);

            return;
        }

        throw new \RuntimeException('Unsupported PDO driver for wgw connection: '.$driver);
    }

    private static function applyMysqlFromPdo(\PDO $pdo): void
    {
        $dbNameStmt = $pdo->query('SELECT DATABASE()');
        $database = $dbNameStmt instanceof \PDOStatement ? (string) ($dbNameStmt->fetchColumn() ?: '') : '';

        config([
            'database.connections.wgw' => array_merge(
                (array) config('database.connections.wgw', []),
                [
                    'driver' => 'mysql',
                    'database' => $database,
                    'foreign_key_constraints' => true,
                ],
            ),
        ]);

        DB::purge('wgw');
        DB::connection('wgw')->setPdo($pdo);
    }

    private static function applySqliteFromPdo(\PDO $pdo): void
    {
        $database = ':memory:';
        $stmt = $pdo->query('PRAGMA database_list');
        if ($stmt instanceof \PDOStatement) {
            foreach ($stmt->fetchAll(\PDO::FETCH_ASSOC) as $row) {
                if (($row['name'] ?? '') === 'main') {
                    $file = (string) ($row['file'] ?? '');
                    if ($file !== '') {
                        $database = $file;
                    }
                    break;
                }
            }
        }

        config([
            'database.connections.wgw' => [
                'driver' => 'sqlite',
                'database' => $database,
                'prefix' => '',
                'foreign_key_constraints' => true,
            ],
        ]);
        DB::purge('wgw');
        SqliteTextLobStatement::enableOn($pdo);
        DB::connection('wgw')->setPdo($pdo);
    }
}

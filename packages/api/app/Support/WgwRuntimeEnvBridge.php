<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Applies {@code WGW_*} values from the process environment into Laravel config at boot
 * (after legacy migration may have patched .env in the same request).
 */
final class WgwRuntimeEnvBridge
{
    public static function apply(WgwInstallConfig $install): void
    {
        $dataDir = self::envString('WGW_DATA_DIR');
        if ($dataDir !== null) {
            config(['wgw.data_dir' => $dataDir]);
        }

        $driver = self::envString('WGW_DB_CONNECTION');
        if ($driver === null) {
            $dataDir = self::envString('WGW_DATA_DIR');
            if ($dataDir === null) {
                return;
            }
            $driver = 'sqlite';
        }

        $wgw = (array) config('database.connections.wgw', []);
        $wgw['driver'] = $driver;

        if ($driver === 'sqlite') {
            $database = self::envString('WGW_DB_DATABASE');
            if ($database === null) {
                $dataDir = self::envString('WGW_DATA_DIR');
                $database = $dataDir !== null
                    ? rtrim($dataDir, '/').'/db.sqlite'
                    : ':memory:';
            }
            if ($database !== ':memory:' && ! self::isAbsolutePath($database)) {
                $database = $install->resolveInstallPath($database);
            }
            $wgw['database'] = $database;
        } else {
            $wgw['host'] = self::envString('WGW_DB_HOST') ?? '127.0.0.1';
            $wgw['port'] = self::envString('WGW_DB_PORT') ?? '3306';
            $wgw['database'] = self::envString('WGW_DB_DATABASE') ?? '';
            $wgw['username'] = self::envString('WGW_DB_USERNAME');
            $wgw['password'] = self::envString('WGW_DB_PASSWORD');
        }

        config(['database.connections.wgw' => $wgw]);
        config(['wgw.installer_db_applied' => false]);
    }

    private static function envString(string $key): ?string
    {
        $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);
        if (! is_string($value)) {
            return null;
        }
        $trimmed = trim($value);

        return $trimmed === '' ? null : $trimmed;
    }

    private static function isAbsolutePath(string $path): bool
    {
        if ($path !== '' && $path[0] === '/') {
            return true;
        }

        return \PHP_OS_FAMILY === 'Windows'
            && strlen($path) > 2
            && ctype_alpha($path[0])
            && $path[1] === ':';
    }
}

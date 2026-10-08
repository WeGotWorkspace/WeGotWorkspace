<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Principal;
use App\Models\User;
use App\Services\Installer\InstallerEnvWriter;
use App\Support\AppPaths;
use App\Support\UpdateFeedDefaults;
use App\Support\WgwInstallConfig;
use App\Support\WgwRuntimeEnvBridge;
use Illuminate\Foundation\Testing\RefreshDatabaseState;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

final class WgwInstallFixture
{
    private static bool $databaseEnvDirty = false;

    /**
     * Point install resolution at a fixture root for the current test request.
     */
    public static function bindInstallRoot(string $installRoot, ?string $dataDir = null): void
    {
        $installRoot = rtrim(str_replace('\\', '/', $installRoot), '/');
        putenv('WGW_APP_ROOT='.$installRoot);
        $_ENV['WGW_APP_ROOT'] = $installRoot;
        $_SERVER['WGW_APP_ROOT'] = $installRoot;

        $config = ['wgw.install_root' => $installRoot];
        if ($dataDir !== null) {
            $config['wgw.data_dir'] = rtrim(str_replace('\\', '/', $dataDir), '/');
        }
        if (function_exists('config')) {
            config($config);
        }

        self::forgetInstallBindings();
    }

    public static function markInstalled(string $installRoot, string $dataDir, string $username = 'admin'): void
    {
        $installRoot = rtrim(str_replace('\\', '/', $installRoot), '/');
        $dataDir = rtrim(str_replace('\\', '/', $dataDir), '/');

        $keysDir = $dataDir.'/keys';
        if (! is_dir($keysDir) && ! @mkdir($keysDir, 0700, true) && ! is_dir($keysDir)) {
            throw new \RuntimeException('Failed to create keys directory: '.$keysDir);
        }
        $keys = AuthTestKeys::rsaPair();
        file_put_contents($dataDir.'/keys/api-jwt-private.pem', $keys['private_key']);
        file_put_contents($dataDir.'/keys/api-jwt-public.pem', $keys['public_key']);

        $relData = self::relativeToInstallRoot($installRoot, $dataDir) ?? './wgw-content';
        $relDb = self::relativeToInstallRoot($installRoot, $dataDir.'/db.sqlite') ?? $relData.'/db.sqlite';

        $apiDir = self::ensureApiPackage($installRoot);
        self::writeRuntimeEnv($installRoot, [
            'WGW_DATA_DIR' => $relData,
            'WGW_UPDATE_FEED_URL' => UpdateFeedDefaults::MANIFEST_URL,
            'WGW_DB_CONNECTION' => 'sqlite',
            'WGW_DB_DATABASE' => $relDb,
        ]);

        self::seedSqliteDatabase($dataDir.'/db.sqlite', $username);
        file_put_contents($dataDir.'/.installed', date('c')."\n");
    }

    public static function ensureApiPackage(string $installRoot): string
    {
        $apiDir = rtrim($installRoot, '/').'/packages/api';
        if (! is_dir($apiDir)) {
            mkdir($apiDir, 0775, true);
        }
        if (! is_file($apiDir.'/artisan')) {
            file_put_contents($apiDir.'/artisan', "# fixture marker\n");
        }
        if (function_exists('base_path') && is_file(base_path('.env.example')) && ! is_file($apiDir.'/.env.example')) {
            copy(base_path('.env.example'), $apiDir.'/.env.example');
        }

        return $apiDir;
    }

    /**
     * @param  array<string, string>  $pairs
     */
    public static function writeRuntimeEnv(string $installRoot, array $pairs): void
    {
        self::ensureApiPackage($installRoot);
        if (! function_exists('app')) {
            throw new \RuntimeException('writeRuntimeEnv requires the Laravel application container.');
        }

        $writer = app(InstallerEnvWriter::class);
        $envPath = $installRoot.'/packages/api/.env';
        $writer->patchEnvFile($envPath, $pairs);
        self::applyPairsToRuntime($pairs);
        config(['wgw.install_root' => $installRoot]);
        self::$databaseEnvDirty = true;
        WgwRuntimeEnvBridge::apply(app(WgwInstallConfig::class));
    }

    /**
     * @param  array<string, string>  $pairs
     */
    private static function applyPairsToRuntime(array $pairs): void
    {
        foreach ($pairs as $key => $value) {
            putenv($key.'='.$value);
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
        }
    }

    public static function forgetInstallBindings(): void
    {
        if (! function_exists('app')) {
            return;
        }
        app()->forgetInstance(WgwInstallConfig::class);
        app()->forgetInstance(AppPaths::class);
    }

    /**
     * Point Laravel's {@code wgw} connection at the sqlite file from {@see markInstalled()}.
     */
    public static function syncDatabaseConnection(): void
    {
        if (! function_exists('app')) {
            return;
        }
        self::forgetInstallBindings();
        WgwRuntimeEnvBridge::apply(app(WgwInstallConfig::class));

        $install = app(WgwInstallConfig::class);
        $wgw = (array) config('database.connections.wgw', []);
        if (($wgw['driver'] ?? '') === 'sqlite') {
            $database = (string) ($wgw['database'] ?? '');
            if ($database !== '' && $database !== ':memory:' && ! self::isAbsolutePath($database)) {
                $wgw['database'] = $install->resolveInstallPath($database);
            }
        }
        config(['database.connections.wgw' => $wgw]);
        DB::purge('wgw');
    }

    /**
     * Reconnect the {@code wgw} connection after install env changes without re-reading config.
     */
    public static function purgeDatabaseConnection(): void
    {
        if (! function_exists('app')) {
            return;
        }
        DB::purge('wgw');
    }

    /**
     * Restore PHPUnit's default install/database env after fixture tests.
     */
    public static function resetInstallEnv(): void
    {
        if (! function_exists('app')) {
            return;
        }

        self::clearInstallEnvOverrides();
        config([
            'wgw.install_root' => null,
            'wgw.data_dir' => null,
        ]);
        self::forgetInstallBindings();
        WgwTestDatabase::configureConnection(WgwTestDatabase::driver());
        self::resetMigratedStateIfNeeded();
    }

    /**
     * Clear install env overrides after the Laravel app has shut down.
     */
    public static function resetInstallEnvAfterApplication(): void
    {
        self::clearInstallEnvOverrides();
        self::resetMigratedStateIfNeeded();
    }

    private static function clearInstallEnvOverrides(): void
    {
        foreach ([
            'WGW_APP_ROOT',
            'WGW_DATA_DIR',
            'WGW_INSTALL_CHANNEL',
            'WGW_DB_CONNECTION',
            'WGW_DB_DATABASE',
            'WGW_UPDATE_FEED_URL',
        ] as $key) {
            putenv($key);
            unset($_ENV[$key], $_SERVER[$key]);
        }

        putenv('WGW_DB_DATABASE=:memory:');
        $_ENV['WGW_DB_DATABASE'] = ':memory:';
        $_SERVER['WGW_DB_DATABASE'] = ':memory:';
    }

    private static function resetMigratedStateIfNeeded(): void
    {
        if (! self::$databaseEnvDirty) {
            return;
        }

        unset(RefreshDatabaseState::$inMemoryConnections['wgw']);
        RefreshDatabaseState::$migrated = false;
        self::$databaseEnvDirty = false;
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

    private static function seedSqliteDatabase(string $path, string $username): void
    {
        if (is_file($path)) {
            @unlink($path);
        }

        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('Failed to create database directory: '.$dir);
        }

        if (! function_exists('app')) {
            throw new \RuntimeException('seedSqliteDatabase requires the Laravel application container.');
        }

        DB::purge('wgw');
        Artisan::call('migrate', [
            '--path' => 'database/migrations/wgw',
            '--database' => 'wgw',
            '--force' => true,
        ]);

        User::query()->create([
            'username' => $username,
            'digesta1' => '',
            'digest' => password_hash('secret', PASSWORD_DEFAULT),
        ]);

        Principal::query()->create([
            'uri' => 'principals/'.$username,
            'email' => null,
            'displayname' => ucfirst($username),
        ]);
    }

    private static function relativeToInstallRoot(string $installRoot, string $absolute): ?string
    {
        $absolute = rtrim(str_replace('\\', '/', $absolute), '/');
        $prefix = $installRoot.'/';
        if (! str_starts_with($absolute, $prefix)) {
            return null;
        }

        return './'.ltrim(substr($absolute, strlen($prefix)), '/');
    }
}

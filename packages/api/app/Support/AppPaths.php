<?php

declare(strict_types=1);

namespace App\Support;

final class AppPaths
{
    public function __construct(
        private WgwInstallConfig $install,
        private WgwDatabaseProbe $databaseProbe,
    ) {}

    public function installRoot(): string
    {
        return $this->install->installRoot();
    }

    public function dataDir(): string
    {
        return $this->install->dataDir();
    }

    public function lockFile(): string
    {
        return rtrim($this->dataDir(), '/').'/.installed';
    }

    public function maintenanceFile(): string
    {
        return rtrim($this->dataDir(), '/').'/.maintenance';
    }

    public function isInstalled(): bool
    {
        if (! $this->runtimeInstallReady()) {
            return false;
        }

        $this->ensureInstallLock();

        return true;
    }

    public function runtimeInstallReady(): bool
    {
        if (! $this->install->hasConfiguredRuntimeEnv()) {
            return false;
        }

        return $this->jwtKeysReady() && $this->databaseReady();
    }

    public function ensureDataDirWebDeny(): void
    {
        WebRootDeny::ensure($this->dataDir());
    }

    public function ensureInstallLock(): void
    {
        $this->ensureDataDirWebDeny();

        if (is_file($this->lockFile())) {
            return;
        }

        @file_put_contents($this->lockFile(), date('c')."\n", LOCK_EX);
        @chmod($this->lockFile(), 0600);
    }

    public function jwtPrivateKeyPath(): string
    {
        return rtrim($this->dataDir(), '/').'/keys/api-jwt-private.pem';
    }

    public function jwtPublicKeyPath(): string
    {
        return rtrim($this->dataDir(), '/').'/keys/api-jwt-public.pem';
    }

    public function jwtKeysReady(): bool
    {
        foreach ([$this->jwtPrivateKeyPath(), $this->jwtPublicKeyPath()] as $path) {
            if (! is_readable($path) || ! is_file($path) || filesize($path) < 32) {
                return false;
            }
        }

        return true;
    }

    public function databaseReady(): bool
    {
        $connection = config('database.connections.wgw');
        if (! is_array($connection)) {
            return false;
        }

        $driver = (string) ($connection['driver'] ?? '');
        $database = (string) ($connection['database'] ?? '');
        if ($driver === '' || $database === '' || $database === ':memory:') {
            return false;
        }

        if ($driver === 'sqlite' && (! is_file($database) || filesize($database) < 1)) {
            return false;
        }

        return $this->databaseProbe->installConfigHasUsers();
    }

    public function clearStaleInstallLock(): void
    {
        if (is_file($this->lockFile()) && ! $this->runtimeInstallReady()) {
            @unlink($this->lockFile());
        }
    }

    public function isMaintenance(): bool
    {
        return is_file($this->maintenanceFile());
    }

    public function configDir(): string
    {
        return $this->installRoot();
    }

    public function pluginsRoot(): string
    {
        return rtrim($this->installRoot(), '/').'/wgw-plugins';
    }

    public function installerSqlDir(string $driver): string
    {
        return dirname(__DIR__, 2).'/resources/installer/sql/'.$driver;
    }

    public function defaultSqliteRelativePath(): string
    {
        return './wgw-content/db.sqlite';
    }

    public function resolveProjectPath(string $path): string
    {
        return $this->install->resolveInstallPath($path);
    }

    public function tryRelativeToInstallRoot(string $absolute): ?string
    {
        $root = rtrim(str_replace('\\', '/', $this->installRoot()), '/');
        $absolute = rtrim(str_replace('\\', '/', $absolute), '/');
        if ($absolute === $root) {
            return '.';
        }
        $prefix = $root.'/';
        if (! str_starts_with($absolute, $prefix)) {
            return null;
        }

        return './'.ltrim(substr($absolute, strlen($prefix)), '/');
    }

    public function appDistIndex(string $app): ?string
    {
        $root = $this->moduleDistRoot($app);

        return $root !== null ? $root.'/index.html' : null;
    }

    public function moduleDistRoot(string $module): ?string
    {
        foreach ($this->moduleDistCandidates($module) as $candidate) {
            if (SafePath::isHtmlFile($candidate.'/index.html')) {
                return $candidate;
            }
        }

        return null;
    }

    public function shellDistRoot(): ?string
    {
        return $this->moduleDistRoot('shell');
    }

    /**
     * @return list<string>
     */
    private function moduleDistCandidates(string $module): array
    {
        return InstallLayout::pathCandidates(
            $this->installRoot(),
            function (string $root) use ($module): array {
                $paths = [$root.'/packages/apps/'.$module.'/dist'];
                if ($module === 'shell') {
                    $paths[] = $root.'/packages/apps/dist';
                }

                return $paths;
            },
        );
    }
}

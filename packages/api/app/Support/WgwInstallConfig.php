<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Install path resolution for the greenfield Laravel app (no legacy Config::load).
 */
final class WgwInstallConfig
{
    private ?string $installRoot = null;

    public function installRoot(): string
    {
        if ($this->installRoot !== null) {
            return $this->installRoot;
        }

        $fromConfig = config('wgw.install_root');
        if (is_string($fromConfig) && $fromConfig !== '' && is_dir($fromConfig)) {
            return $this->installRoot = $this->normalize($fromConfig);
        }

        $fromEnv = getenv('WGW_APP_ROOT');
        if (! is_string($fromEnv) || $fromEnv === '') {
            $fromEnv = $_ENV['WGW_APP_ROOT'] ?? null;
        }
        if (is_string($fromEnv) && $fromEnv !== '' && is_dir($fromEnv)) {
            return $this->installRoot = $this->normalize($fromEnv);
        }

        $cwd = getcwd();
        if (is_string($cwd) && $this->looksLikeInstallRoot($cwd)) {
            return $this->installRoot = $this->normalize($cwd);
        }

        $monorepo = dirname(__DIR__, 4).'/apps/wegotworkspace';
        if (is_dir($monorepo) && $this->looksLikeInstallRoot($monorepo)) {
            return $this->installRoot = $this->normalize($monorepo);
        }

        return $this->installRoot = dirname(__DIR__, 2);
    }

    public function apiEnvPath(): string
    {
        return $this->installRoot().'/packages/api/.env';
    }

    public function dataDir(): string
    {
        $configured = config('wgw.data_dir');
        if (is_string($configured) && $configured !== '') {
            return $this->resolvePath($configured);
        }

        return $this->installRoot().'/wgw-content';
    }

    public function filesDir(): string
    {
        return rtrim($this->dataDir(), '/').'/files';
    }

    public function resolveInstallPath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        if ($path === '') {
            return rtrim($this->dataDir(), '/').'/db.sqlite';
        }
        if ($this->isAbsolutePath($path)) {
            return rtrim($path, '/');
        }

        return rtrim($this->installRoot().'/'.$this->relativeInstallSegment($path), '/');
    }

    private function isAbsolutePath(string $path): bool
    {
        if ($path !== '' && $path[0] === '/') {
            return true;
        }

        return \PHP_OS_FAMILY === 'Windows'
            && strlen($path) > 2
            && ctype_alpha($path[0])
            && $path[1] === ':';
    }

    public function installChannel(): ?string
    {
        $fromEnv = config('wgw.install_channel');
        if (is_string($fromEnv) && trim($fromEnv) !== '') {
            return strtolower(trim($fromEnv));
        }

        return null;
    }

    public function hasRuntimeDatabaseConfig(): bool
    {
        $connection = (string) config('database.connections.wgw.driver', '');
        if ($connection === '') {
            return false;
        }

        $database = (string) config('database.connections.wgw.database', '');
        if ($connection === 'sqlite') {
            return $database !== '' && $database !== ':memory:';
        }

        return $database !== '';
    }

    /**
     * True when {@see apiEnvPath()} was written by the installer or legacy migrator.
     * Replaces the former wgw-config.php readability gate in {@see AppPaths::isInstalled()}.
     */
    public function hasConfiguredRuntimeEnv(): bool
    {
        if ($this->hasRuntimeDatabaseConfig()) {
            return true;
        }

        $path = $this->apiEnvPath();
        if (! is_readable($path)) {
            return false;
        }

        if (WgwApiEnvFile::hasRealDatabaseConfig($path)) {
            return true;
        }

        // Default-path SQLite installs keep example-identical WGW_DB_* lines in .env.
        $privateKey = rtrim($this->dataDir(), '/').'/keys/api-jwt-private.pem';

        return is_readable($privateKey) && is_file($privateKey) && filesize($privateKey) >= 32;
    }

    private function resolvePath(string $path): string
    {
        $path = str_replace('\\', '/', trim($path));
        if ($path === '') {
            return $this->installRoot();
        }
        if ($path[0] === '/') {
            return rtrim($path, '/');
        }

        return rtrim($this->installRoot().'/'.$this->relativeInstallSegment($path), '/');
    }

    private function relativeInstallSegment(string $path): string
    {
        $relative = ltrim($path, '/');
        while (str_starts_with($relative, './')) {
            $relative = substr($relative, 2);
        }

        return $relative;
    }

    private function looksLikeInstallRoot(string $dir): bool
    {
        $dir = rtrim(str_replace('\\', '/', $dir), '/');

        return is_file($dir.'/index.php')
            || is_file($dir.'/packages/api/.env');
    }

    private function normalize(string $path): string
    {
        return rtrim(str_replace('\\', '/', $path), '/');
    }
}

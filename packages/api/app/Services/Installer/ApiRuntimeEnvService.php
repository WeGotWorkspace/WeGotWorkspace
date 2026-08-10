<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\WgwApiEnvFile;

/**
 * Ensures packages/api runtime files exist on install and after in-place updates.
 */
final class ApiRuntimeEnvService
{
    /** @var list<string> */
    private const STORAGE_DIRS = [
        'storage/framework/cache',
        'storage/framework/sessions',
        'storage/framework/views',
        'storage/logs',
        'bootstrap/cache',
    ];

    public function apiPackageRoot(string $installRoot): ?string
    {
        $root = rtrim(str_replace('\\', '/', $installRoot), '/').'/packages/api';
        if (is_file($root.'/vendor/autoload.php') || is_file($root.'/artisan')) {
            return $root;
        }

        // Monorepo dev: install shell at apps/wegotworkspace without packages/api subtree.
        $runtime = dirname(__DIR__, 4);
        if (! is_dir($root) && is_file($runtime.'/vendor/autoload.php')) {
            return $runtime;
        }

        return null;
    }

    /**
     * @return array{createdEnv: bool, generatedKey: bool, patchedUrl: bool}
     */
    public function ensure(string $installRoot, ?string $appUrl = null): array
    {
        return $this->ensureAtApiRoot($this->apiPackageRoot($installRoot), $appUrl);
    }

    /**
     * @return array{createdEnv: bool, generatedKey: bool, patchedUrl: bool}
     */
    public function ensureAtApiRoot(?string $apiRoot, ?string $appUrl = null): array
    {
        if ($apiRoot === null || ! is_file($apiRoot.'/vendor/autoload.php')) {
            return ['createdEnv' => false, 'generatedKey' => false, 'patchedUrl' => false];
        }

        $this->ensureStorageDirectories($apiRoot);

        $createdEnv = $this->seedEnvFromExampleIfMissing($apiRoot);
        $envPath = $apiRoot.'/.env';
        $generatedKey = is_file($envPath) && $this->ensureAppKey($envPath);
        $patchedUrl = is_file($envPath) && $this->patchAppUrlIfUnset($envPath, $appUrl);

        return [
            'createdEnv' => $createdEnv,
            'generatedKey' => $generatedKey,
            'patchedUrl' => $patchedUrl,
        ];
    }

    public function seedEnvFromExampleIfMissing(string $apiRoot): bool
    {
        $env = $apiRoot.'/.env';
        if (is_file($env)) {
            return false;
        }
        $example = $apiRoot.'/.env.example';
        if (! is_file($example)) {
            return false;
        }

        return @copy($example, $env);
    }

    public function ensureStorageDirectories(string $apiRoot): void
    {
        foreach (self::STORAGE_DIRS as $relative) {
            $path = $apiRoot.'/'.$relative;
            if (! is_dir($path)) {
                @mkdir($path, 0775, true);
            }
        }
    }

    public function ensureAppKey(string $envPath): bool
    {
        $content = is_readable($envPath) ? (string) file_get_contents($envPath) : '';
        $appKey = WgwApiEnvFile::readValue($content, 'APP_KEY') ?? '';
        if ($appKey !== '' && preg_match('/^base64:[A-Za-z0-9+\/=]+$/', $appKey) === 1) {
            return false;
        }

        $key = 'base64:'.base64_encode(random_bytes(32));
        if ($content === '' || ! WgwApiEnvFile::hasKey($content, 'APP_KEY')) {
            $content = rtrim($content)."\nAPP_KEY={$key}\n";
        } else {
            $content = WgwApiEnvFile::setLine($content, 'APP_KEY', $key, quote: false);
        }

        return file_put_contents($envPath, $content, LOCK_EX) !== false;
    }

    public function patchAppUrlIfUnset(string $envPath, ?string $appUrl): bool
    {
        if (! is_string($appUrl) || trim($appUrl) === '') {
            return false;
        }
        $appUrl = rtrim(trim($appUrl), '/');
        $content = (string) file_get_contents($envPath);
        $current = WgwApiEnvFile::readValue($content, 'APP_URL') ?? '';
        if ($current !== '' && $current !== 'http://localhost' && ! str_starts_with($current, 'http://127.0.0.1')) {
            return false;
        }
        if (! WgwApiEnvFile::hasKey($content, 'APP_URL')) {
            $content = rtrim($content)."\nAPP_URL={$appUrl}\n";
        } else {
            $content = WgwApiEnvFile::setLine($content, 'APP_URL', $appUrl, quote: false);
        }

        return file_put_contents($envPath, $content, LOCK_EX) !== false;
    }

    public static function guessRequestAppUrl(): ?string
    {
        $host = $_SERVER['HTTP_HOST'] ?? null;
        if (! is_string($host) || trim($host) === '') {
            return null;
        }
        $https = (! empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
            || (isset($_SERVER['SERVER_PORT']) && (string) $_SERVER['SERVER_PORT'] === '443')
            || (isset($_SERVER['HTTP_X_FORWARDED_PROTO']) && strtolower((string) $_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https');
        $scheme = $https ? 'https' : 'http';

        return $scheme.'://'.trim($host);
    }
}

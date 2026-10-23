<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\WgwApiEnvFile;
use Dotenv\Exception\InvalidFileException;

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

    public function __construct(
        private EnvFileWriter $envFiles = new EnvFileWriter,
    ) {}

    public function apiPackageRoot(string $installRoot): ?string
    {
        $root = rtrim(str_replace('\\', '/', $installRoot), '/').'/packages/api';
        if (is_file($root.'/vendor/autoload.php') || is_file($root.'/artisan')) {
            return $root;
        }

        // Monorepo dev: install shell at apps/wegotworkspace without packages/api subtree.
        // This file lives at app/Services/Installer/ → three levels up is packages/api.
        $runtime = dirname(__DIR__, 3);
        if (! is_dir($root) && is_file($runtime.'/vendor/autoload.php')) {
            return $runtime;
        }

        return null;
    }

    /**
     * @return array{createdEnv: bool, generatedKey: bool, patchedUrl: bool, sanitizedEnv: bool}
     */
    public function ensure(string $installRoot, ?string $appUrl = null): array
    {
        return $this->ensureAtApiRoot($this->apiPackageRoot($installRoot), $appUrl);
    }

    /**
     * @return array{createdEnv: bool, generatedKey: bool, patchedUrl: bool, sanitizedEnv: bool}
     */
    public function ensureAtApiRoot(?string $apiRoot, ?string $appUrl = null): array
    {
        if ($apiRoot === null || ! is_file($apiRoot.'/vendor/autoload.php')) {
            return ['createdEnv' => false, 'generatedKey' => false, 'patchedUrl' => false, 'sanitizedEnv' => false];
        }

        $this->ensureStorageDirectories($apiRoot);

        $createdEnv = $this->seedEnvFromExampleIfMissing($apiRoot);
        $envPath = $apiRoot.'/.env';
        $sanitizedEnv = is_file($envPath) && $this->sanitizeInvalidEnvLines($envPath);
        $generatedKey = is_file($envPath) && $this->ensureAppKey($envPath);
        $patchedUrl = is_file($envPath) && $this->patchAppUrlIfUnset($envPath, $appUrl);

        return [
            'createdEnv' => $createdEnv,
            'generatedKey' => $generatedKey,
            'patchedUrl' => $patchedUrl,
            'sanitizedEnv' => $sanitizedEnv,
        ];
    }

    public function sanitizeInvalidEnvLines(string $envPath): bool
    {
        return $this->updateEnvFile($envPath, static function (string $content): ?string {
            if ($content === '') {
                return null;
            }
            $sanitized = WgwApiEnvFile::stripInvalidLines($content);

            return $sanitized === $content ? null : $sanitized;
        });
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

    /**
     * The one rule for "this APP_KEY can stay". ensureAppKey() replaces
     * anything else; wgw:ensure-env fails on anything else.
     */
    public static function isUsableAppKey(?string $appKey): bool
    {
        return $appKey !== null && preg_match('/^base64:[A-Za-z0-9+\/=]+$/', $appKey) === 1;
    }

    public function hasUsableAppKey(string $envPath): bool
    {
        if (! is_readable($envPath)) {
            return false;
        }
        try {
            return self::isUsableAppKey(WgwApiEnvFile::readEffectiveValue((string) file_get_contents($envPath), 'APP_KEY'));
        } catch (InvalidFileException) {
            return false;
        }
    }

    public function ensureAppKey(string $envPath): bool
    {
        return $this->updateEnvFile($envPath, static function (string $content): ?string {
            // Never replace a usable key: everything Crypt sealed under it
            // (refresh tokens, share links, collab ticket key) would be lost.
            // Read it the way Laravel does; if dotenv cannot parse the file,
            // leave it alone rather than guess.
            try {
                $appKey = WgwApiEnvFile::readEffectiveValue($content, 'APP_KEY');
            } catch (InvalidFileException) {
                return null;
            }
            if (self::isUsableAppKey($appKey)) {
                return null;
            }

            $key = 'base64:'.base64_encode(random_bytes(32));
            if ($appKey === null) {
                $eol = str_contains($content, "\r\n") ? "\r\n" : "\n";

                return ($content === '' ? '' : rtrim($content).$eol)."APP_KEY={$key}{$eol}";
            }

            // Fill the first APP_KEY line and drop any others, so one line is left.
            // Same line shapes dotenv accepts: indent, `export`, spaces around `=`.
            $seen = false;

            return (string) preg_replace_callback(
                '/^[ \t]*(?:export[ \t]+)?APP_KEY[ \t]*=[^\r\n]*(\r?\n|$)/m',
                static function (array $m) use (&$seen, $key): string {
                    if ($seen) {
                        return '';
                    }
                    $seen = true;

                    return "APP_KEY={$key}".$m[1];
                },
                $content,
            );
        });
    }

    public function patchAppUrlIfUnset(string $envPath, ?string $appUrl): bool
    {
        if (! is_string($appUrl) || trim($appUrl) === '') {
            return false;
        }
        $appUrl = rtrim(trim($appUrl), '/');

        return $this->updateEnvFile($envPath, static function (string $content) use ($appUrl): ?string {
            $current = WgwApiEnvFile::readValue($content, 'APP_URL') ?? '';
            if ($current !== '' && $current !== 'http://localhost' && ! str_starts_with($current, 'http://127.0.0.1')) {
                return null;
            }
            if (! WgwApiEnvFile::hasKey($content, 'APP_URL')) {
                return rtrim($content)."\nAPP_URL={$appUrl}\n";
            }

            return WgwApiEnvFile::setLine($content, 'APP_URL', $appUrl, quote: false);
        });
    }

    /**
     * @param  callable(string): ?string  $mutator
     */
    private function updateEnvFile(string $envPath, callable $mutator): bool
    {
        return $this->envFiles->update($envPath, $mutator);
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;
use App\Support\UpdateFeedDefaults;
use App\Support\WgwApiEnvFile;
use Illuminate\Support\Facades\Artisan;

final class InstallerEnvWriter
{
    public function __construct(
        private AppPaths $paths,
        private ApiRuntimeEnvService $apiEnv,
    ) {}

    /**
     * @param  array{pdo: array<string, mixed>, data_dir?: string}  $config
     */
    public function writeBootstrap(array $config): void
    {
        if (! isset($config['pdo']) || ! is_array($config['pdo'])) {
            throw new \RuntimeException('Bootstrap config must contain a pdo array.');
        }

        $pairs = $this->envPairsFromBootstrap($config);
        $envPath = $this->envPath();
        $this->patchEnvFile($envPath, $pairs);
        $this->applyPairsToRuntime($pairs);
        $this->clearConfigIfAvailable();
    }

    /**
     * @param  array<string, string|null>  $pairs
     */
    public function patchEnvFile(string $envPath, array $pairs): void
    {
        if (! is_file($envPath) && is_file(dirname($envPath).'/.env.example')) {
            copy(dirname($envPath).'/.env.example', $envPath);
        }

        $fh = fopen($envPath, 'c+');
        if ($fh === false) {
            throw new \RuntimeException('Could not write packages/api/.env');
        }

        try {
            if (! flock($fh, LOCK_EX)) {
                throw new \RuntimeException('Could not lock packages/api/.env');
            }
            rewind($fh);
            $content = (string) stream_get_contents($fh);
            $original = $content;
            foreach ($pairs as $key => $value) {
                if ($value === null) {
                    continue;
                }
                $content = WgwApiEnvFile::setLine($content, $key, $value);
            }
            if ($content !== $original) {
                rewind($fh);
                if (ftruncate($fh, 0) === false || fwrite($fh, $content) === false) {
                    throw new \RuntimeException('Could not write packages/api/.env');
                }
                fflush($fh);
            }
            @chmod($envPath, 0600);
        } finally {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
    }

    public function envPath(): string
    {
        $apiRoot = $this->apiEnv->apiPackageRoot($this->paths->installRoot());
        if ($apiRoot === null) {
            throw new \RuntimeException('packages/api is not available at the install root.');
        }
        $this->apiEnv->seedEnvFromExampleIfMissing($apiRoot);

        return $apiRoot.'/.env';
    }

    /**
     * @param  array{pdo: array<string, mixed>, data_dir?: string}  $config
     * @return array<string, string>
     */
    public function envPairsFromBootstrap(array $config): array
    {
        $dataDir = isset($config['data_dir']) && is_string($config['data_dir']) && trim($config['data_dir']) !== ''
            ? trim($config['data_dir'])
            : './wgw-content';
        $pdo = $this->normalizePdo($config['pdo']);

        $pairs = [
            'WGW_DATA_DIR' => $dataDir,
            'WGW_UPDATE_FEED_URL' => UpdateFeedDefaults::MANIFEST_URL,
        ];

        if (isset($pdo['sqlite_file'])) {
            $pairs['WGW_DB_CONNECTION'] = 'sqlite';
            $pairs['WGW_DB_DATABASE'] = $pdo['sqlite_file'];

            return $pairs;
        }

        $parsed = $this->parseMysqlDsn((string) ($pdo['dsn'] ?? ''));

        return array_merge($pairs, [
            'WGW_DB_CONNECTION' => 'mysql',
            'WGW_DB_HOST' => $parsed['host'],
            'WGW_DB_PORT' => $parsed['port'],
            'WGW_DB_DATABASE' => $parsed['database'],
            'WGW_DB_USERNAME' => (string) ($pdo['user'] ?? ''),
            'WGW_DB_PASSWORD' => (string) ($pdo['password'] ?? ''),
        ]);
    }

    /**
     * @param  array<string, mixed>  $pdo
     * @return array<string, mixed>
     */
    private function normalizePdo(array $pdo): array
    {
        if (isset($pdo['sqlite_file']) && is_string($pdo['sqlite_file']) && trim($pdo['sqlite_file']) !== '') {
            return ['sqlite_file' => trim($pdo['sqlite_file'])];
        }

        if (isset($pdo['dsn']) && is_string($pdo['dsn']) && str_starts_with(trim($pdo['dsn']), 'sqlite:')) {
            return ['sqlite_file' => substr(trim($pdo['dsn']), 7)];
        }

        if (isset($pdo['dsn']) && is_string($pdo['dsn']) && trim($pdo['dsn']) !== '') {
            return [
                'dsn' => trim($pdo['dsn']),
                'user' => isset($pdo['user']) && is_string($pdo['user']) ? $pdo['user'] : '',
                'password' => isset($pdo['password']) && is_string($pdo['password']) ? $pdo['password'] : '',
            ];
        }

        throw new \RuntimeException('Bootstrap pdo config must include sqlite_file or dsn.');
    }

    /**
     * @return array{host: string, port: string, database: string}
     */
    private function parseMysqlDsn(string $dsn): array
    {
        $body = str_starts_with($dsn, 'mysql:') ? substr($dsn, 6) : $dsn;
        $params = [];
        foreach (explode(';', $body) as $part) {
            if (! str_contains($part, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $part, 2);
            $params[strtolower(trim($key))] = trim($value);
        }

        return [
            'host' => $params['host'] ?? '127.0.0.1',
            'port' => $params['port'] ?? '3306',
            'database' => $params['dbname'] ?? '',
        ];
    }

    private function clearConfigIfAvailable(): void
    {
        if (! class_exists(Artisan::class)) {
            return;
        }

        try {
            Artisan::call('config:clear');
        } catch (\Throwable) {
            // Pre-Laravel bootstrap may not have Artisan ready.
        }
    }

    /**
     * @param  array<string, string>  $pairs
     */
    private function applyPairsToRuntime(array $pairs): void
    {
        foreach ($pairs as $key => $value) {
            putenv($key.'='.$value);
            $_ENV[$key] = $value;
            $_SERVER[$key] = $value;
        }
    }
}

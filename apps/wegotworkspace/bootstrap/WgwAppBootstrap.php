<?php

declare(strict_types=1);

/**
 * Install/runtime path resolution before Laravel boots.
 *
 * UI, REST, and WebDAV are handled inside packages/api once public/index.php loads.
 */
final class WgwAppBootstrap
{
    public static function run(string $appRoot): void
    {
        require_once __DIR__.'/WgwSafePath.php';

        self::seedAppRootEnv($appRoot);
        self::ensureApacheHtaccess($appRoot);

        $runtimeRoot = self::resolveRuntimeRoot($appRoot);
        $apiPackageRoot = self::resolveApiPackageRoot($appRoot, $runtimeRoot);

        if ($apiPackageRoot !== null) {
            self::ensureApiRuntimeEnv($apiPackageRoot);
            self::migrateLegacyConfigIfNeeded($appRoot, $apiPackageRoot);
            require $apiPackageRoot.'/public/index.php';

            return;
        }

        self::respondApiUnavailable(self::findApiPackageWithoutVendor($appRoot, $runtimeRoot));
    }

    private static function seedAppRootEnv(string $appRoot): void
    {
        if (is_string(getenv('WGW_APP_ROOT')) && trim((string) getenv('WGW_APP_ROOT')) !== '') {
            return;
        }

        putenv('WGW_APP_ROOT='.$appRoot);
        $_ENV['WGW_APP_ROOT'] = $appRoot;
    }

    private static function resolveRuntimeRoot(string $appRoot): string
    {
        $buildDir = getenv('SABRE_BUILD_DIR');
        if (! is_string($buildDir) || trim($buildDir) === '') {
            return $appRoot;
        }

        $buildDir = trim(str_replace('\\', '/', $buildDir));

        if ($buildDir[0] === '/') {
            return rtrim($buildDir, '/');
        }

        if (str_contains($buildDir, '..')) {
            header('Content-Type: text/plain; charset=utf-8');
            http_response_code(500);
            echo "Invalid SABRE_BUILD_DIR (must not contain '..').\n";
            exit;
        }

        return rtrim($appRoot, '/').'/'.ltrim($buildDir, '/');
    }

    /**
     * @return list<string>
     */
    private static function apiPackageCandidates(string $appRoot, string $runtimeRoot): array
    {
        $normalized = rtrim(str_replace('\\', '/', $appRoot), '/');
        $installCandidates = [
            $appRoot.'/packages/api',
            $runtimeRoot.'/packages/api',
        ];
        $preferred = [];

        $configured = self::configuredApiPackageRoot();
        if ($configured !== null) {
            $preferred[] = $configured;
        }

        // Host checkout: .../apps/wegotworkspace → sibling packages/api.
        if (str_ends_with($normalized, '/apps/wegotworkspace')) {
            $preferred[] = dirname($normalized, 2).'/packages/api';
        }

        // Docker compose.dev.yml: DocumentRoot is remapped to /var/www/install, so
        // the /apps/wegotworkspace suffix check above does not fire. Prefer the
        // bind-mounted live API over the nested install copy (often a stale build).
        if ($normalized === '/var/www/install') {
            $preferred[] = '/var/www/packages/api';
        }

        return array_values(array_unique([...$preferred, ...$installCandidates]));
    }

    private static function configuredApiPackageRoot(): ?string
    {
        $raw = $_SERVER['WGW_API_ROOT'] ?? $_ENV['WGW_API_ROOT'] ?? getenv('WGW_API_ROOT');
        if (! is_string($raw)) {
            return null;
        }
        $root = rtrim(str_replace('\\', '/', trim($raw)), '/');
        if ($root === '' || str_contains($root, '..')) {
            return null;
        }

        return $root;
    }

    private static function resolveApiPackageRoot(string $appRoot, string $runtimeRoot): ?string
    {
        foreach (self::apiPackageCandidates($appRoot, $runtimeRoot) as $candidate) {
            if (! WgwSafePath::isFile($candidate.'/public/index.php')) {
                continue;
            }
            if (WgwSafePath::isFile($candidate.'/vendor/autoload.php')) {
                return $candidate;
            }
        }

        return null;
    }

    private static function findApiPackageWithoutVendor(string $appRoot, string $runtimeRoot): ?string
    {
        foreach (self::apiPackageCandidates($appRoot, $runtimeRoot) as $candidate) {
            if (WgwSafePath::isFile($candidate.'/public/index.php')) {
                return $candidate;
            }
        }

        return null;
    }

    private static function ensureApacheHtaccess(string $appRoot): void
    {
        $root = rtrim(str_replace('\\', '/', $appRoot), '/');
        $htaccess = $root.'/.htaccess';
        $example = $root.'/example.htaccess';

        if (WgwSafePath::isFile($htaccess) || ! WgwSafePath::isFile($example)) {
            return;
        }

        @copy($example, $htaccess);
    }

    private static function migrateLegacyConfigIfNeeded(string $appRoot, string $apiPackageRoot): void
    {
        \App\Services\Installer\WgwConfigMigrator::migrateAtPaths($appRoot, $apiPackageRoot, false);
    }

    private static function ensureApiRuntimeEnv(string $apiPackageRoot): void
    {
        require_once $apiPackageRoot.'/vendor/autoload.php';

        (new \App\Services\Installer\ApiRuntimeEnvService)->ensureAtApiRoot(
            $apiPackageRoot,
            \App\Services\Installer\ApiRuntimeEnvService::guessRequestAppUrl(),
        );
    }

    private static function respondApiUnavailable(?string $apiPackageWithoutVendor): void
    {
        header('Content-Type: application/json; charset=utf-8');
        http_response_code(503);

        if ($apiPackageWithoutVendor !== null) {
            echo json_encode([
                'error' => 'api_unavailable',
                'message' => 'Composer vendor/ is missing for the API app. Run `composer --working-dir packages/api install` from the repo root (monorepo dev), or `pnpm --filter @wgw/api build` for a self-contained install tree.',
                'path' => $apiPackageWithoutVendor,
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        } else {
            echo json_encode([
                'error' => 'api_unavailable',
                'message' => 'packages/api Laravel runtime is missing.',
            ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        }

        exit;
    }
}

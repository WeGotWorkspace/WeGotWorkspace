<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;

final class InstallerEnvChecker
{
    public const MIN_PHP = '8.3.0';

    public function __construct(private AppPaths $paths) {}

    /**
     * @return list<array{ok: bool, label: string, detail: string, optional?: bool}>
     */
    public function checkAll(string $dbDriver): array
    {
        $checks = [$this->phpVersion()];
        foreach (['pdo', 'dom', 'mbstring', 'json', 'ctype', 'iconv', 'simplexml', 'openssl'] as $ext) {
            $checks[] = $this->extension($ext);
        }
        $checks[] = $this->extension($dbDriver === 'mysql' ? 'pdo_mysql' : 'pdo_sqlite');
        // Informational only — common shared-hosting gap. Mail degrades to 503
        // `imap_extension_required` without it; install/update must not block.
        $checks[] = $this->optionalExtension('imap', 'required only for the Mail app (IMAP mailbox access)');
        $checks[] = $this->writable($this->paths->dataDir());
        $checks[] = $this->writable($this->paths->configDir());
        foreach ($this->apiRuntimeChecks($this->paths->installRoot()) as $check) {
            $checks[] = $check;
        }

        return $checks;
    }

    /**
     * @return list<array{ok: bool, label: string, detail: string}>
     */
    private function apiRuntimeChecks(string $installRoot): array
    {
        $apiRoot = rtrim(str_replace('\\', '/', $installRoot), '/').'/packages/api';
        if (! is_file($apiRoot.'/vendor/autoload.php')) {
            return [];
        }

        $checks = [];
        $env = $apiRoot.'/.env';
        $example = $apiRoot.'/.env.example';
        if (is_file($env)) {
            $checks[] = [
                'ok' => is_readable($env),
                'label' => 'Laravel API environment',
                'detail' => is_readable($env) ? 'packages/api/.env present' : 'packages/api/.env is not readable',
            ];
        } elseif (is_file($example)) {
            $checks[] = [
                'ok' => is_writable($apiRoot),
                'label' => 'Laravel API environment',
                'detail' => 'Will create packages/api/.env on install (from .env.example)',
            ];
        } else {
            $checks[] = [
                'ok' => false,
                'label' => 'Laravel API environment',
                'detail' => 'Missing packages/api/.env.example in the deploy package',
            ];
        }

        $checks[] = $this->writable($apiRoot.'/storage');
        $checks[] = $this->writable($apiRoot.'/bootstrap/cache');

        return $checks;
    }

    /**
     * @param  list<array{ok: bool, label: string, detail: string, optional?: bool}>  $checks
     */
    public function allPassed(array $checks): bool
    {
        foreach ($checks as $check) {
            if (! $check['ok'] && ! ($check['optional'] ?? false)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return array{ok: bool, label: string, detail: string}
     */
    private function phpVersion(): array
    {
        $ok = version_compare(PHP_VERSION, self::MIN_PHP, '>=');

        return [
            'ok' => $ok,
            'label' => 'PHP version',
            'detail' => $ok ? PHP_VERSION : PHP_VERSION.' (need '.self::MIN_PHP.' or newer)',
        ];
    }

    /**
     * @return array{ok: bool, label: string, detail: string}
     */
    private function extension(string $name): array
    {
        $ok = extension_loaded($name);

        return [
            'ok' => $ok,
            'label' => 'Extension: '.$name,
            'detail' => $ok ? 'Loaded' : 'Missing',
        ];
    }

    /**
     * An extension the app can run without: reported honestly but never
     * counted by allPassed(), so a missing one cannot block install or update.
     *
     * @return array{ok: bool, label: string, detail: string, optional: bool}
     */
    private function optionalExtension(string $name, string $why): array
    {
        $ok = extension_loaded($name);

        return [
            'ok' => $ok,
            'label' => 'Extension: '.$name.' (optional)',
            'detail' => $ok ? 'Loaded' : 'Missing — '.$why,
            'optional' => true,
        ];
    }

    /**
     * @return array{ok: bool, label: string, detail: string}
     */
    private function writable(string $path): array
    {
        if (! is_dir($path)) {
            @mkdir($path, 0775, true);
        }
        $ok = is_dir($path) && is_writable($path);

        return [
            'ok' => $ok,
            'label' => 'Writable: '.$path,
            'detail' => $ok ? 'Yes' : 'No — adjust permissions for the web server user',
        ];
    }
}

#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * CI/local guard: fail if greenfield Laravel app/ code uses legacy patterns.
 * Exit 0 when packages/api/app/ does not exist yet (scaffold not started).
 */
$apiRoot = dirname(__DIR__);
$appRoot = $apiRoot.'/app';

if (! is_dir($appRoot)) {
    fwrite(STDOUT, "greenfield-guard: skip (no packages/api/app/ yet)\n");

    exit(0);
}

$scanRoots = [
    $appRoot.'/Http/Controllers',
    $appRoot.'/Http/Requests',
    $appRoot.'/Services',
    $appRoot.'/Repositories',
    $appRoot.'/Storage',
    $appRoot.'/Dav',
    $appRoot.'/Ui',
    $appRoot.'/Models',
];

/** @var list<array{pattern: string, message: string}> */
$forbidden = [
    ['pattern' => '/\bApp\\\\Paths\b|\bPaths::/', 'message' => 'Use WgwStorage/Flysystem, not Paths'],
    ['pattern' => '/\bfile_put_contents\s*\(|\bfile_get_contents\s*\(|\breadfile\s*\(|\bfopen\s*\(/', 'message' => 'Use Storage/Flysystem, not raw PHP file functions'],
    ['pattern' => '/\bMailApi\b|\bDriveKernel\b|\bApiKernel\b|\bDomainRouteService\b/', 'message' => 'Do not reference legacy handlers'],
    ['pattern' => '/\bWgwRuntime\b|\bApiResultReady\b|\bPendingHttpResponse\b/', 'message' => 'Use ApiResult/Resources, not legacy response shims'],
    ['pattern' => '/\bConfig::load\s*\(/', 'message' => 'Use Laravel config(), not Config::load()'],
    ['pattern' => '/function\s+\w+\s*\([^)]*\\\\PDO\s+\$\w+/', 'message' => 'Do not pass PDO into domain APIs — use Eloquent/DB'],
    ['pattern' => '/\*\s*ApiService\s+that\s+only\s+forwards/i', 'message' => 'Remove misleading comments; implement services'],
];

$errors = [];

foreach ($scanRoots as $root) {
    if (! is_dir($root)) {
        continue;
    }
    scanDirectory($root, $forbidden, $errors);
}

$servicesRoot = $appRoot.'/Services';
if (is_dir($servicesRoot)) {
    scanServicesNoDbTable($servicesRoot, $errors);
    scanServicesNoRuntimeDdl($servicesRoot, $errors);
    scanServicesLineLimitTraits($servicesRoot, $appRoot, $errors);
}

$composerPath = $apiRoot.'/composer.json';
if (is_readable($composerPath)) {
    $composer = (string) file_get_contents($composerPath);
    if (str_contains($composer, 'wgw-src')) {
        $errors[] = ['file' => 'composer.json', 'line' => 0, 'message' => 'Remove wgw-src classmap; use PSR-4 app/ only'];
    }
}

$routesApi = $apiRoot.'/routes/api.php';
if (is_readable($routesApi)) {
    $routes = (string) file_get_contents($routesApi);
    if (preg_match('/DomainRouteService|DomainRouteController::class,\s*[\'"]handle[\'"]/i', $routes)) {
        $errors[] = ['file' => 'routes/api.php', 'line' => 0, 'message' => 'Use per-domain controllers, not single DomainRoute catch-all'];
    }
}

if ($errors !== []) {
    fwrite(STDERR, "greenfield-guard: FAILED\n");
    foreach ($errors as $e) {
        $loc = $e['line'] > 0 ? ':'.$e['line'] : '';
        fwrite(STDERR, "  {$e['file']}{$loc}: {$e['message']}\n");
    }

    exit(1);
}

fwrite(STDOUT, "greenfield-guard: OK\n");

exit(0);

/**
 * @param  list<array{pattern: string, message: string}>  $forbidden
 * @param  list<array{file: string, line: int, message: string}>  $errors
 */
function scanDirectory(string $dir, array $forbidden, array &$errors): void
{
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $path = $file->getPathname();
        $lines = file($path);
        if ($lines === false) {
            continue;
        }
        $isInstallerService = str_contains(
            $path,
            DIRECTORY_SEPARATOR.'Services'.DIRECTORY_SEPARATOR.'Installer'.DIRECTORY_SEPARATOR
        );

        foreach ($lines as $num => $line) {
            foreach ($forbidden as $rule) {
                if (
                    str_contains($rule['message'], 'Config::load')
                    && str_contains($path, DIRECTORY_SEPARATOR.'Providers'.DIRECTORY_SEPARATOR)
                ) {
                    continue;
                }
                if (
                    $isInstallerService
                    && (
                        str_contains($rule['message'], 'PDO')
                        || str_contains($rule['message'], 'Flysystem')
                    )
                ) {
                    continue;
                }
                if (
                    preg_match('#/Dav/Server/#i', str_replace('\\', '/', $path))
                    && (
                        str_contains($rule['message'], 'PDO')
                        || str_contains($rule['message'], 'Flysystem')
                        || str_contains($rule['message'], 'raw PHP file')
                    )
                ) {
                    continue;
                }
                if (
                    preg_match('#/Ui/#i', str_replace('\\', '/', $path))
                    && str_contains($rule['message'], 'raw PHP file')
                ) {
                    continue;
                }
                if (
                    preg_match('#/Services/Update/#i', str_replace('\\', '/', $path))
                ) {
                    continue;
                }
                if (
                    preg_match('#/Dav/Storage/#i', str_replace('\\', '/', $path))
                    && str_contains($rule['message'], 'raw PHP file')
                ) {
                    continue;
                }
                if (preg_match($rule['pattern'], $line)) {
                    $errors[] = [
                        'file' => relativePath($path),
                        'line' => $num + 1,
                        'message' => $rule['message'],
                    ];
                }
            }
        }
    }
}

function relativePath(string $absolute): string
{
    $apiRoot = dirname(__DIR__);

    return str_starts_with($absolute, $apiRoot.'/')
        ? 'packages/api/'.substr($absolute, strlen($apiRoot) + 1)
        : $absolute;
}

/**
 * @return list<string>
 */
function domainServiceExcludedPrefixes(string $servicesRoot): array
{
    return [
        $servicesRoot.DIRECTORY_SEPARATOR.'Installer'.DIRECTORY_SEPARATOR,
        $servicesRoot.DIRECTORY_SEPARATOR.'Update'.DIRECTORY_SEPARATOR,
        $servicesRoot.DIRECTORY_SEPARATOR.'Settings'.DIRECTORY_SEPARATOR,
        $servicesRoot.DIRECTORY_SEPARATOR.'Admin'.DIRECTORY_SEPARATOR,
        $servicesRoot.DIRECTORY_SEPARATOR.'Auth'.DIRECTORY_SEPARATOR,
    ];
}

function scanServicesNoDbTable(string $servicesRoot, array &$errors): void
{
    $excludedPrefixes = domainServiceExcludedPrefixes($servicesRoot);

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($servicesRoot, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $path = $file->getPathname();
        foreach ($excludedPrefixes as $prefix) {
            if (str_starts_with($path, $prefix)) {
                continue 2;
            }
        }

        $lines = file($path);
        if ($lines === false) {
            continue;
        }

        foreach ($lines as $num => $line) {
            if (preg_match('/DB::connection\([^)]+\)->table\(/', $line)) {
                $errors[] = [
                    'file' => relativePath($path),
                    'line' => $num + 1,
                    'message' => 'Use Eloquent models in Services, not DB::connection()->table()',
                ];
            }
        }
    }
}

/**
 * Traits under Services must live in a Concerns/ directory and be shared by
 * at least two classes. Traits that exist only to shrink one class under the
 * 800-line ratchet are not a valid split — use injected classes instead.
 *
 * @param  list<array{file: string, line: int, message: string}>  $errors
 */
function scanServicesLineLimitTraits(string $servicesRoot, string $appRoot, array &$errors): void
{
    foreach (collectLineLimitTraitViolations($servicesRoot, $appRoot) as $violation) {
        $errors[] = $violation;
    }
}

/**
 * @return list<array{file: string, line: int, message: string}>
 */
function collectLineLimitTraitViolations(string $servicesRoot, string $appRoot): array
{
    /** @var list<array{file: string, line: int, shortName: string, inConcerns: bool}> $traits */
    $traits = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($servicesRoot, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $path = $file->getPathname();
        $lines = file($path);
        if ($lines === false) {
            continue;
        }
        foreach ($lines as $num => $line) {
            if (preg_match('/^\s*(?:final\s+|abstract\s+)?trait\s+(\w+)\b/', $line, $matches) !== 1) {
                continue;
            }
            $normalized = str_replace('\\', '/', $path);
            $traits[] = [
                'file' => relativePath($path),
                'line' => $num + 1,
                'shortName' => $matches[1],
                'inConcerns' => str_contains($normalized, '/Concerns/'),
            ];
            break;
        }
    }

    if ($traits === []) {
        return [];
    }

    $classBodyUseCounts = countClassBodyTraitUses($appRoot);
    $message = 'Service traits must live under Concerns/ and be used by 2+ classes; '
        .'traits that exist only to get a file under 800 lines are not a split — use injected classes';

    $violations = [];
    foreach ($traits as $trait) {
        $uses = $classBodyUseCounts[$trait['shortName']] ?? 0;
        if ($trait['inConcerns'] && $uses >= 2) {
            continue;
        }
        $detail = $trait['inConcerns']
            ? "used by {$uses} class(es)"
            : 'not under Concerns/';
        $violations[] = [
            'file' => $trait['file'],
            'line' => $trait['line'],
            'message' => $message.' ('.$detail.')',
        ];
    }

    return $violations;
}

/**
 * Count `use TraitName;` inside class bodies under app/ (not header imports).
 *
 * @return array<string, int> short trait name => class use count
 */
function countClassBodyTraitUses(string $appRoot): array
{
    /** @var array<string, int> $counts */
    $counts = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($appRoot, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $content = (string) file_get_contents($file->getPathname());
        if (! preg_match('/\bclass\s+\w+/', $content)) {
            continue;
        }
        foreach (extractPhpTypeBodies($content) as $body) {
            if (preg_match_all('/^\s*use\s+(?!function\b|const\b)([^;]+);/m', $body, $matches) === false) {
                continue;
            }
            foreach ($matches[1] as $clause) {
                foreach (explode(',', $clause) as $part) {
                    $aliasSplit = preg_split('/\s+as\s+/i', trim($part), 2) ?: [];
                    $name = ltrim(trim((string) ($aliasSplit[0] ?? '')), '\\');
                    if ($name === '') {
                        continue;
                    }
                    if (str_contains($name, '\\')) {
                        $name = basename(str_replace('\\', '/', $name));
                    }
                    if ($name === '') {
                        continue;
                    }
                    $counts[$name] = ($counts[$name] ?? 0) + 1;
                }
            }
        }
    }

    return $counts;
}

/**
 * @return list<string>
 */
function extractPhpTypeBodies(string $content): array
{
    $stripped = preg_replace('/\/\*[\s\S]*?\*\//', '', $content) ?? $content;
    $stripped = preg_replace('/\/\/[^\n]*/', '', $stripped) ?? $stripped;
    $bodies = [];
    if (preg_match_all('/\b(?:class|trait|interface|enum)\s+\w+[^{]*\{/', $stripped, $matches, PREG_OFFSET_CAPTURE) === false) {
        return [];
    }
    foreach ($matches[0] as $match) {
        $openAt = $match[1] + strlen($match[0]) - 1;
        $depth = 0;
        $len = strlen($stripped);
        for ($i = $openAt; $i < $len; $i++) {
            $ch = $stripped[$i];
            if ($ch === '{') {
                $depth++;
            } elseif ($ch === '}') {
                $depth--;
                if ($depth === 0) {
                    $bodies[] = substr($stripped, $openAt, $i - $openAt + 1);
                    break;
                }
            }
        }
    }

    return $bodies;
}

/**
 * Schema changes belong in migrations, not runtime service DDL.
 *
 * @param  list<array{file: string, line: int, message: string}>  $errors
 */
function scanServicesNoRuntimeDdl(string $servicesRoot, array &$errors): void
{
    $excludedPrefixes = domainServiceExcludedPrefixes($servicesRoot);

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($servicesRoot, FilesystemIterator::SKIP_DOTS)
    );

    foreach ($iterator as $file) {
        if (! $file->isFile() || $file->getExtension() !== 'php') {
            continue;
        }
        $path = $file->getPathname();
        foreach ($excludedPrefixes as $prefix) {
            if (str_starts_with($path, $prefix)) {
                continue 2;
            }
        }

        $lines = file($path);
        if ($lines === false) {
            continue;
        }

        foreach ($lines as $num => $line) {
            if (preg_match('/\bALTER\s+TABLE\b/i', $line)) {
                $errors[] = [
                    'file' => relativePath($path),
                    'line' => $num + 1,
                    'message' => 'Use wgw migrations for DDL, not runtime ALTER TABLE in services',
                ];
            }
        }
    }
}

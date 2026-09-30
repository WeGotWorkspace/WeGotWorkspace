#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Dependency-free PHPUnit test-file sharding helper.
 *
 * Used as a library (include for the wgw_* functions) and as a CLI:
 *
 *   php scripts/phpunit-shard.php --config=phpunit.xml --shard=1/2 \
 *       [--exclude-suite=Architecture]... [--print] [-- <extra phpunit args>]
 *
 * The shard index/total may also be supplied via the WGW_PHPUNIT_SHARD env var
 * (format "I/N"). Files are resolved from the config's testsuites, sorted, and
 * assigned round-robin to N shards so that adding tests rebalances automatically.
 */

/**
 * Parse an "I/N" shard spec into a 1-based [index, total] pair.
 *
 * @return array{0: int, 1: int}
 */
function wgw_parse_shard(string $spec): array
{
    if (! preg_match('#^\s*(\d+)\s*/\s*(\d+)\s*$#', $spec, $m)) {
        throw new InvalidArgumentException("Invalid shard spec '{$spec}'; expected I/N (e.g. 1/2).");
    }

    $index = (int) $m[1];
    $total = (int) $m[2];

    if ($total < 1 || $index < 1 || $index > $total) {
        throw new InvalidArgumentException("Invalid shard spec '{$spec}'; need 1 <= I <= N and N >= 1.");
    }

    return [$index, $total];
}

/**
 * Resolve a path to its real absolute form, or '' when it does not exist.
 */
function wgw_shard_real(string $path): string
{
    $real = realpath($path);

    return $real === false ? '' : $real;
}

/**
 * Recursively collect files under $dir whose name ends with $suffix.
 *
 * @return list<string> Absolute real paths.
 */
function wgw_shard_find_files(string $dir, string $suffix): array
{
    $real = wgw_shard_real($dir);
    if ($real === '' || ! is_dir($real)) {
        return [];
    }

    $out = [];
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($real, FilesystemIterator::SKIP_DOTS),
    );

    foreach ($iterator as $file) {
        /** @var SplFileInfo $file */
        if ($file->isFile() && str_ends_with($file->getFilename(), $suffix)) {
            $out[] = $file->getPathname();
        }
    }

    return $out;
}

/**
 * @param  list<string>  $excludedRealPaths
 */
function wgw_shard_is_excluded(string $path, array $excludedRealPaths): bool
{
    foreach ($excludedRealPaths as $excluded) {
        if ($path === $excluded || str_starts_with($path, rtrim($excluded, '/').'/')) {
            return true;
        }
    }

    return false;
}

/**
 * Resolve the test files selected by a phpunit config's testsuites.
 *
 * Handles <directory> (recursive, honoring the suffix attribute, default
 * "Test.php"), <file>, and <exclude> entries. Returns sorted, unique absolute
 * paths so callers can partition them deterministically.
 *
 * @param  list<string>  $excludeSuites  Testsuite names to skip entirely.
 * @return list<string>
 */
function wgw_resolve_testsuite_files(string $configPath, array $excludeSuites = []): array
{
    $real = wgw_shard_real($configPath);
    if ($real === '') {
        throw new InvalidArgumentException("phpunit config not found: {$configPath}");
    }

    $root = dirname($real);
    $contents = file_get_contents($real);
    if ($contents === false) {
        throw new RuntimeException("unable to read phpunit config: {$real}");
    }

    $xml = new SimpleXMLElement($contents);
    $files = [];

    foreach ($xml->testsuites->testsuite as $suite) {
        if (in_array((string) $suite['name'], $excludeSuites, true)) {
            continue;
        }

        $excluded = [];
        foreach ($suite->exclude as $exclude) {
            $resolved = wgw_shard_real($root.'/'.trim((string) $exclude));
            if ($resolved !== '') {
                $excluded[] = $resolved;
            }
        }

        foreach ($suite->directory as $directory) {
            $suffix = trim((string) ($directory['suffix'] ?? ''));
            if ($suffix === '') {
                $suffix = 'Test.php';
            }

            foreach (wgw_shard_find_files($root.'/'.trim((string) $directory), $suffix) as $file) {
                if (! wgw_shard_is_excluded($file, $excluded)) {
                    $files[$file] = true;
                }
            }
        }

        foreach ($suite->file as $file) {
            $resolved = wgw_shard_real($root.'/'.trim((string) $file));
            if ($resolved !== '' && is_file($resolved) && ! wgw_shard_is_excluded($resolved, $excluded)) {
                $files[$resolved] = true;
            }
        }
    }

    $paths = array_keys($files);
    sort($paths, SORT_STRING);

    return $paths;
}

/**
 * Assign files to shard $index of $total using round-robin over the sorted list.
 *
 * @param  list<string>  $files
 * @return list<string>
 */
function wgw_partition_files(array $files, int $index, int $total): array
{
    $out = [];
    foreach ($files as $position => $file) {
        if ($position % $total === $index - 1) {
            $out[] = $file;
        }
    }

    return $out;
}

// --- CLI ----------------------------------------------------------------------

if (! isset($argv[0]) || wgw_shard_real($argv[0]) !== wgw_shard_real(__FILE__)) {
    // Included as a library; expose functions only.
    return;
}

$options = [
    'config' => null,
    'shard' => getenv('WGW_PHPUNIT_SHARD') ?: null,
    'exclude' => [],
    'print' => false,
];
$passthru = [];
$afterDashDash = false;

foreach (array_slice($argv, 1) as $arg) {
    if ($afterDashDash) {
        $passthru[] = $arg;

        continue;
    }

    if ($arg === '--') {
        $afterDashDash = true;
    } elseif (str_starts_with($arg, '--config=')) {
        $options['config'] = substr($arg, strlen('--config='));
    } elseif (str_starts_with($arg, '--shard=')) {
        $options['shard'] = substr($arg, strlen('--shard='));
    } elseif (str_starts_with($arg, '--exclude-suite=')) {
        $options['exclude'][] = substr($arg, strlen('--exclude-suite='));
    } elseif ($arg === '--print') {
        $options['print'] = true;
    } else {
        fwrite(STDERR, "phpunit-shard: unknown argument '{$arg}'\n");
        exit(2);
    }
}

if ($options['config'] === null) {
    fwrite(STDERR, "phpunit-shard: --config is required\n");
    exit(2);
}

if ($options['shard'] === null || trim((string) $options['shard']) === '') {
    fwrite(STDERR, "phpunit-shard: shard not set (use --shard=I/N or WGW_PHPUNIT_SHARD)\n");
    exit(2);
}

$apiRoot = dirname(__DIR__);
$configPath = is_file($options['config']) ? $options['config'] : $apiRoot.'/'.$options['config'];

[$index, $total] = wgw_parse_shard((string) $options['shard']);
$files = wgw_resolve_testsuite_files($configPath, $options['exclude']);
$slice = wgw_partition_files($files, $index, $total);

if ($options['print']) {
    foreach ($slice as $file) {
        echo $file, "\n";
    }
    exit(0);
}

if ($slice === []) {
    fwrite(STDERR, "phpunit-shard: shard {$index}/{$total} resolved to 0 files\n");
    exit(1);
}

$phpunit = $apiRoot.'/vendor/bin/phpunit';
if (! is_file($phpunit)) {
    fwrite(STDERR, "phpunit-shard: vendor/bin/phpunit missing — run: composer install\n");
    exit(127);
}

$command = array_merge(
    [$phpunit, '-c', $configPath, '--display-deprecations', '--display-phpunit-deprecations'],
    $passthru,
    $slice,
);
$line = implode(' ', array_map(static fn (string $part): string => escapeshellarg($part), $command));

fwrite(STDOUT, '→ phpunit-shard '.$index.'/'.$total.': '.count($slice).' of '.count($files)." files\n\n");
passthru($line, $exitCode);
exit((int) $exitCode);

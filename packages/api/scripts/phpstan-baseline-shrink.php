#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Fail when the summed `count:` in phpstan-baseline.neon is higher than on the base ref.
 *
 * A missing baseline on the base ref is the initial file and is allowed.
 * Default base ref is origin/main. Override with PHPSTAN_BASELINE_BASE.
 */

/**
 * @return array{sum: int, error: null}|array{sum: null, error: string}
 */
function phpstan_baseline_parse(string $neon): array
{
    $counts = [];
    $countMatches = preg_match_all('/^[ \t]*count:\s*(\d+)\s*$/m', $neon, $counts);
    $identifierMatches = preg_match_all('/^[ \t]*identifier:/m', $neon);

    if ($countMatches === false || $identifierMatches === false) {
        return ['sum' => null, 'error' => 'failed to parse phpstan-baseline.neon'];
    }

    if ($countMatches !== $identifierMatches) {
        return [
            'sum' => null,
            'error' => 'phpstan-baseline.neon entries must each have a count: line',
        ];
    }

    $sum = 0;
    foreach ($counts[1] as $raw) {
        $sum += (int) $raw;
    }

    return ['sum' => $sum, 'error' => null];
}

function phpstan_baseline_shrink_error(?int $baseSum, int $headSum): ?string
{
    if ($baseSum === null || $headSum <= $baseSum) {
        return null;
    }

    return "PHPStan baseline count rose from {$baseSum} to {$headSum} (origin ceiling is shrink-only).";
}

function phpstan_baseline_git_show_kind(string $stderr): string
{
    if (preg_match('/does not exist in|exists on disk, but not in/i', $stderr) === 1) {
        return 'missing-path';
    }

    if (preg_match('/invalid object name|bad revision|unknown revision|Needed a single revision|ambiguous argument/i', $stderr) === 1) {
        return 'unknown-ref';
    }

    return 'other';
}

function phpstan_baseline_shrink_main(string $repoRoot): int
{
    $baseRef = getenv('PHPSTAN_BASELINE_BASE');
    if (! is_string($baseRef) || trim($baseRef) === '') {
        $baseRef = 'origin/main';
    } else {
        $baseRef = trim($baseRef);
    }

    $relativePath = 'packages/api/phpstan-baseline.neon';
    $headPath = $repoRoot.'/'.$relativePath;
    $headNeon = is_file($headPath) ? (string) file_get_contents($headPath) : '';
    $head = phpstan_baseline_parse($headNeon);
    if ($head['error'] !== null) {
        fwrite(STDERR, "phpstan-baseline-shrink: {$head['error']}\n");

        return 1;
    }

    $command = 'git -C '.escapeshellarg($repoRoot).' show '.escapeshellarg($baseRef.':'.$relativePath).' 2>&1';
    $output = [];
    $exitCode = 0;
    exec($command, $output, $exitCode);
    $shown = implode("\n", $output);

    if ($exitCode !== 0) {
        $kind = phpstan_baseline_git_show_kind($shown);
        if ($kind === 'missing-path') {
            fwrite(STDOUT, "PHPStan baseline shrink check passed (no baseline on {$baseRef}).\n");

            return 0;
        }

        if ($kind === 'unknown-ref') {
            fwrite(STDERR, "phpstan-baseline-shrink: base ref '{$baseRef}' is unknown. Fetch it, then retry.\n");

            return 1;
        }

        fwrite(STDERR, "phpstan-baseline-shrink: git show failed:\n{$shown}\n");

        return 1;
    }

    $base = phpstan_baseline_parse($shown);
    if ($base['error'] !== null || $base['sum'] === null || $head['sum'] === null) {
        $message = $base['error'] ?? 'failed to parse the base baseline';
        fwrite(STDERR, "phpstan-baseline-shrink: {$message}\n");

        return 1;
    }

    $error = phpstan_baseline_shrink_error($base['sum'], $head['sum']);
    if ($error !== null) {
        fwrite(STDERR, "phpstan-baseline-shrink: {$error}\n");

        return 1;
    }

    fwrite(STDOUT, "PHPStan baseline shrink check passed ({$head['sum']} <= {$base['sum']} on {$baseRef}).\n");

    return 0;
}

$cliArguments = $_SERVER['argv'] ?? [];
if (! is_array($cliArguments)) {
    $cliArguments = [];
}

$invokedDirectly = isset($cliArguments[0]) && realpath((string) $cliArguments[0]) === realpath(__FILE__);
if ($invokedDirectly) {
    exit(phpstan_baseline_shrink_main(dirname(__DIR__, 3)));
}

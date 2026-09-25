#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * API done gate with labeled steps and a final summary.
 *
 * Usage:
 *   php scripts/done-gate.php           # guard + architecture + full PHPUnit
 *   php scripts/done-gate.php --contract
 *   php scripts/done-gate.php --full      # + MySQL test driver
 *   php scripts/done-gate.php --verbose     # testdox on full suite
 */
$apiRoot = dirname(__DIR__);
$phpunit = $apiRoot.'/vendor/bin/phpunit';
$config = $apiRoot.'/phpunit.xml';

$contractOnly = in_array('--contract', $argv, true);
$full = in_array('--full', $argv, true);
$verbose = in_array('--verbose', $argv, true) || getenv('DONE_GATE_VERBOSE') === '1';

/*
 * Optional CI sharding: DONE_GATE_SHARD=I/N runs only shard I's slice of the
 * unit/feature/storage test files (round-robin by sorted path). Shard 1 also
 * runs greenfield-guard + the Architecture suite; later shards run tests only.
 * Unset (local default) keeps the full gate behaviour below.
 */
$shardSpec = getenv('DONE_GATE_SHARD');
$shardIndex = 1;
$shardTotal = 1;
$isSharded = false;
if ($shardSpec !== false && trim($shardSpec) !== '') {
    require_once __DIR__.'/phpunit-shard.php';
    [$shardIndex, $shardTotal] = wgw_parse_shard($shardSpec);
    $isSharded = $shardTotal > 1;
}
$runContractSteps = ! $isSharded || $shardIndex === 1;

if (! is_file($phpunit)) {
    fwrite(STDERR, "done-gate: vendor/bin/phpunit missing — run: composer install\n");
    exit(127);
}

/** @var list<array{label: string, ok: bool, detail?: string}> */
$results = [];

function done_gate_step(string $label): void
{
    fwrite(STDOUT, "\n".str_repeat('─', 72)."\n");
    fwrite(STDOUT, $label."\n");
    fwrite(STDOUT, str_repeat('─', 72)."\n");
}

/**
 * @param  list<string>  $command
 */
function done_gate_run(array $command, ?string $envPrefix = null): int
{
    $line = implode(' ', array_map(static fn (string $part): string => escapeshellarg($part), $command));
    if ($envPrefix !== null && $envPrefix !== '') {
        $line = $envPrefix.' '.$line;
    }
    fwrite(STDOUT, "→ {$line}\n\n");
    passthru($line, $exitCode);

    return (int) $exitCode;
}

/**
 * @return list<string>
 */
function done_gate_phpunit_base(string $phpunit, string $config): array
{
    return [
        $phpunit,
        '-c',
        $config,
        '--display-deprecations',
        '--display-phpunit-deprecations',
    ];
}

/**
 * @param  list<array{label: string, ok: bool, detail?: string}>  $results
 */
function done_gate_summary(array $results, bool $passed): void
{
    fwrite(STDOUT, "\n".str_repeat('═', 72)."\n");
    fwrite(STDOUT, $passed ? "DONE GATE: PASSED\n" : "DONE GATE: FAILED\n");
    fwrite(STDOUT, str_repeat('═', 72)."\n");

    foreach ($results as $row) {
        $mark = $row['ok'] ? '✓' : '✗';
        $detail = isset($row['detail']) ? " — {$row['detail']}" : '';
        fwrite(STDOUT, "  {$mark} {$row['label']}{$detail}\n");
    }

    if ($passed) {
        fwrite(STDOUT, "\nNotes:\n");
        fwrite(STDOUT, "  • \"OK, but there were issues!\" from PHPUnit means deprecations, not test failures.\n");
        fwrite(STDOUT, "  • D in progress output = a test triggered a deprecation (details printed above).\n");
        fwrite(STDOUT, "  • Docs: packages/api/docs/api-done-gate.md\n");
    }

    fwrite(STDOUT, "\n");
}

$step = 1;
if ($contractOnly) {
    $totalSteps = 3;
} elseif ($full) {
    $totalSteps = 5;
} elseif (! $runContractSteps) {
    $totalSteps = 1;
} else {
    $totalSteps = 4;
}

if ($runContractSteps) {
    done_gate_step("Step {$step}/{$totalSteps}: file-size ratchet");
    $ratchetScript = dirname($apiRoot).'/tools/file-size-ratchet.mjs';
    $ratchetCode = done_gate_run(['node', $ratchetScript, 'check', 'packages/api/app']);
    $results[] = ['label' => 'file-size ratchet', 'ok' => $ratchetCode === 0];
    $step++;

    if ($ratchetCode !== 0) {
        done_gate_summary($results, false);
        exit($ratchetCode);
    }

    done_gate_step("Step {$step}/{$totalSteps}: greenfield-guard");
    $guardCode = done_gate_run(['php', $apiRoot.'/scripts/greenfield-guard.php']);
    $results[] = ['label' => 'greenfield-guard', 'ok' => $guardCode === 0];
    $step++;

    if ($guardCode !== 0) {
        done_gate_summary($results, false);
        exit($guardCode);
    }

    done_gate_step("Step {$step}/{$totalSteps}: architecture (OpenAPI ↔ routes, role matrix, guards)");
    $archCode = done_gate_run([
        ...done_gate_phpunit_base($phpunit, $config),
        '--testsuite',
        'Architecture',
        '--testdox',
    ]);
    $results[] = [
        'label' => 'architecture',
        'ok' => $archCode === 0,
        'detail' => 'contract + role matrix',
    ];
    $step++;

    if ($archCode !== 0) {
        done_gate_summary($results, false);
        exit($archCode);
    }
}

if ($contractOnly) {
    done_gate_summary($results, true);
    exit(0);
}

$phpunitLabel = $isSharded
    ? "PHPUnit (unit + feature + storage — shard {$shardIndex}/{$shardTotal})"
    : 'PHPUnit (unit + feature + storage)';
done_gate_step("Step {$step}/{$totalSteps}: {$phpunitLabel}");

$testCommand = done_gate_phpunit_base($phpunit, $config);
if ($verbose) {
    $testCommand[] = '--testdox';
}

if ($isSharded) {
    $shardFiles = wgw_partition_files(
        wgw_resolve_testsuite_files($config, ['Architecture']),
        $shardIndex,
        $shardTotal,
    );

    if ($shardFiles === []) {
        fwrite(STDERR, "done-gate: shard {$shardIndex}/{$shardTotal} resolved to 0 test files\n");
        exit(1);
    }

    $testCommand = array_merge($testCommand, $shardFiles);
    $testDetail = sprintf('unit + feature + storage shard %d/%d (%d files)', $shardIndex, $shardTotal, count($shardFiles));
} else {
    $testCommand[] = '--exclude-testsuite';
    $testCommand[] = 'Architecture';
    $testDetail = 'unit + feature + storage (architecture already run)';
}

$testCode = done_gate_run($testCommand);
$results[] = [
    'label' => 'phpunit (full)',
    'ok' => $testCode === 0,
    'detail' => $testDetail,
];
$step++;

if ($testCode !== 0) {
    done_gate_summary($results, false);
    exit($testCode);
}

if ($full) {
    done_gate_step("Step {$step}/{$totalSteps}: PHPUnit (MySQL driver — WGW_TEST_DRIVER=mysql)");
    $mysqlCode = done_gate_run(
        done_gate_phpunit_base($phpunit, $config),
        'WGW_TEST_DRIVER=mysql',
    );
    $results[] = [
        'label' => 'phpunit (mysql)',
        'ok' => $mysqlCode === 0,
    ];

    if ($mysqlCode !== 0) {
        done_gate_summary($results, false);
        exit($mysqlCode);
    }
}

done_gate_summary($results, true);
exit(0);

#!/usr/bin/env php
<?php

declare(strict_types=1);

/**
 * Merge PHPUnit --coverage-php shard files into one clover report.
 *
 *   php scripts/merge-coverage.php <clover.xml> <shard.cov> [<shard.cov>...]
 *
 * CI runs the coverage suite in round-robin shards (scripts/phpunit-shard.php).
 * Each shard writes a serialized CodeCoverage object; this script merges them
 * with php-code-coverage's own merge (the same one phpcov uses), so a line
 * covered in any shard counts as covered in the clover file.
 *
 * A shard file lists every test that ran each line: a few hundred MB on disk
 * and more once loaded. Two things keep the merge to about one shard in memory:
 * - The serialized object is read and unserialized directly. Including the
 *   file would compile it into a string literal that PHP keeps until exit.
 * - Clover only needs covered or not, so each shard is compacted to one marker
 *   per covered line before the merge. A line's clover count becomes the
 *   number of shards that ran it, not the number of tests.
 */

use SebastianBergmann\CodeCoverage\CodeCoverage;
use SebastianBergmann\CodeCoverage\Data\ProcessedCodeCoverageData;
use SebastianBergmann\CodeCoverage\Driver\PcovDriver;
use SebastianBergmann\CodeCoverage\Driver\XdebugDriver;
use SebastianBergmann\CodeCoverage\Filter;
use SebastianBergmann\CodeCoverage\Report\Clover;
use SebastianBergmann\CodeCoverage\StaticAnalysis\CachingFileAnalyser;
use SebastianBergmann\CodeCoverage\StaticAnalysis\ParsingFileAnalyser;
use SebastianBergmann\CodeUnitReverseLookup\Wizard;

/**
 * Load a --coverage-php file without compiling it, or return null.
 */
function wgw_load_coverage(string $file): ?CodeCoverage
{
    $open = "<<<'END_OF_COVERAGE_SERIALIZATION'\n";
    $close = "\nEND_OF_COVERAGE_SERIALIZATION";

    $contents = file_get_contents($file);
    if ($contents === false) {
        return null;
    }

    $start = strpos($contents, $open);
    $end = strrpos($contents, $close);
    if ($start === false || $end === false || $end < $start) {
        return null;
    }

    $start += strlen($open);
    $serialized = substr($contents, $start, $end - $start);
    unset($contents);

    // The object graph PHPUnit 11 writes for a pcov or Xdebug run.
    $coverage = unserialize($serialized, ['allowed_classes' => [
        CodeCoverage::class,
        ProcessedCodeCoverageData::class,
        PcovDriver::class,
        XdebugDriver::class,
        Filter::class,
        CachingFileAnalyser::class,
        ParsingFileAnalyser::class,
        Wizard::class,
    ]]);

    return $coverage instanceof CodeCoverage ? $coverage : null;
}

/**
 * Replace each covered line's test list with one shard marker and drop the tests.
 */
function wgw_compact_coverage(CodeCoverage $coverage, string $marker): void
{
    $data = $coverage->getData(true);
    $lines = $data->lineCoverage();

    foreach ($lines as $file => $fileLines) {
        foreach ($fileLines as $line => $tests) {
            if (is_array($tests) && $tests !== []) {
                $lines[$file][$line] = [$marker];
            }
        }
    }

    $data->setLineCoverage($lines);
    $coverage->setData($data);
    $coverage->setTests([]);
}

$cli = $argv ?? [];
$target = $cli[1] ?? '';
$args = array_slice($cli, 2);
if ($target === '' || $args === []) {
    fwrite(STDERR, "usage: php scripts/merge-coverage.php <clover.xml> <shard.cov> [<shard.cov>...]\n");
    exit(2);
}

require dirname(__DIR__).'/vendor/autoload.php';

$merged = null;

foreach ($args as $file) {
    if (! is_file($file)) {
        fwrite(STDERR, "merge-coverage: shard file not found: {$file}\n");
        exit(1);
    }

    $coverage = wgw_load_coverage($file);
    if ($coverage === null) {
        fwrite(STDERR, "merge-coverage: not a PHPUnit --coverage-php file: {$file}\n");
        exit(1);
    }

    wgw_compact_coverage($coverage, 'shard:'.basename($file));

    if ($merged === null) {
        $merged = $coverage;
    } else {
        $merged->merge($coverage);
    }

    unset($coverage);
    gc_collect_cycles();
}

$dir = dirname($target);
if (! is_dir($dir) && ! mkdir($dir, 0777, true) && ! is_dir($dir)) {
    fwrite(STDERR, "merge-coverage: cannot create {$dir}\n");
    exit(1);
}

(new Clover)->process($merged, $target);

fwrite(STDOUT, 'merge-coverage: '.count($args)." shard(s) → {$target}\n");

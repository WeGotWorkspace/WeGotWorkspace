<?php

declare(strict_types=1);

namespace Tests\Unit\Scripts;

use PHPUnit\Framework\TestCase;
use ReflectionClass;
use SebastianBergmann\CodeCoverage\CodeCoverage;
use SebastianBergmann\CodeCoverage\Data\RawCodeCoverageData;
use SebastianBergmann\CodeCoverage\Driver\PcovDriver;
use SebastianBergmann\CodeCoverage\Filter;
use SebastianBergmann\CodeCoverage\Report\PHP;
use SimpleXMLElement;
use Symfony\Component\Process\Process;

/**
 * scripts/merge-coverage.php only runs on push to main (the api-coverage job),
 * so this test is what catches a php-code-coverage upgrade that changes the
 * --coverage-php format or its object graph on a pull request.
 */
final class MergeCoverageTest extends TestCase
{
    private const string FIXTURE = <<<'PHP'
<?php

function merge_coverage_fixture_add(int $x): int
{
    return $x + 1;
}

function merge_coverage_fixture_double(int $x): int
{
    return $x * 2;
}

PHP;

    private string $dir;

    private string $source;

    private string $untouched;

    protected function setUp(): void
    {
        $dir = sys_get_temp_dir().'/wgw-merge-coverage-'.bin2hex(random_bytes(6));
        mkdir($dir);
        $this->dir = (string) realpath($dir);
        $this->source = $this->dir.'/fixture.php';
        $this->untouched = $this->dir.'/untouched.php';
        file_put_contents($this->source, self::FIXTURE);
        file_put_contents($this->untouched, str_replace('merge_coverage_fixture_', 'merge_coverage_untouched_', self::FIXTURE));
    }

    protected function tearDown(): void
    {
        foreach (glob($this->dir.'/*') ?: [] as $file) {
            unlink($file);
        }
        rmdir($this->dir);
    }

    public function test_a_line_covered_in_any_shard_is_covered_in_the_clover_file(): void
    {
        // Line 5 is the body of add(), line 10 the body of double().
        $first = $this->writeShard('first', [5 => 1, 10 => -1]);
        $second = $this->writeShard('second', [5 => -1, 10 => 1]);

        $process = $this->merge([$this->dir.'/clover.xml', $first, $second]);

        $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
        $this->assertSame(['statements' => 2, 'covered' => 2], $this->fileMetrics($this->source));
        $this->assertSame(['statements' => 2, 'covered' => 0], $this->fileMetrics($this->untouched));
    }

    public function test_one_shard_keeps_its_uncovered_lines(): void
    {
        $first = $this->writeShard('first', [5 => 1, 10 => -1]);

        $process = $this->merge([$this->dir.'/clover.xml', $first]);

        $this->assertSame(0, $process->getExitCode(), $process->getErrorOutput());
        $this->assertSame(['statements' => 2, 'covered' => 1], $this->fileMetrics($this->source));
    }

    public function test_a_file_that_is_not_coverage_output_fails(): void
    {
        $bogus = $this->dir.'/bogus.cov';
        file_put_contents($bogus, "<?php\nreturn 1;\n");

        $process = $this->merge([$this->dir.'/clover.xml', $bogus]);

        $this->assertSame(1, $process->getExitCode());
        $this->assertStringContainsString('not a PHPUnit --coverage-php file', $process->getErrorOutput());
        $this->assertFileDoesNotExist($this->dir.'/clover.xml');
    }

    public function test_missing_shards_print_the_usage(): void
    {
        $process = $this->merge([$this->dir.'/clover.xml']);

        $this->assertSame(2, $process->getExitCode());
        $this->assertStringContainsString('usage:', $process->getErrorOutput());
    }

    /**
     * Write a --coverage-php file the way PHPUnit does after a pcov run.
     *
     * @param  array<int, int>  $lines  Xdebug-style line hits: 1 ran, -1 did not.
     */
    private function writeShard(string $name, array $lines): string
    {
        $filter = new Filter;
        $filter->includeFiles([$this->source, $this->untouched]);

        // The pcov constructor requires the extension, which CI quality jobs do not load.
        $driver = (new ReflectionClass(PcovDriver::class))->newInstanceWithoutConstructor();

        $coverage = new CodeCoverage($driver, $filter);
        $coverage->append(
            RawCodeCoverageData::fromXdebugWithoutPathCoverage([$this->source => $lines]),
            'Tests\\Fixture::test_'.$name,
        );

        $path = $this->dir.'/'.$name.'.cov';
        (new PHP)->process($coverage, $path);

        return $path;
    }

    /**
     * @param  list<string>  $args
     */
    private function merge(array $args): Process
    {
        $process = new Process([PHP_BINARY, dirname(__DIR__, 3).'/scripts/merge-coverage.php', ...$args]);
        $process->run();

        return $process;
    }

    /**
     * @return array{statements: int, covered: int}
     */
    private function fileMetrics(string $file): array
    {
        $xml = new SimpleXMLElement((string) file_get_contents($this->dir.'/clover.xml'));
        $metrics = $xml->xpath('//file[@name="'.$file.'"]/metrics');
        if (! is_array($metrics) || $metrics === []) {
            $this->fail("clover lists no metrics for {$file}");
        }

        return [
            'statements' => (int) $metrics[0]['statements'],
            'covered' => (int) $metrics[0]['coveredstatements'],
        ];
    }
}

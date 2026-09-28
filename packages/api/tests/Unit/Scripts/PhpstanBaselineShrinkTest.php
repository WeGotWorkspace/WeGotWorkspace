<?php

declare(strict_types=1);

namespace Tests\Unit\Scripts;

use PHPUnit\Framework\TestCase;

require_once dirname(__DIR__, 3).'/scripts/phpstan-baseline-shrink.php';

final class PhpstanBaselineShrinkTest extends TestCase
{
    public function test_parse_sums_count_lines(): void
    {
        $parsed = phpstan_baseline_parse(<<<'NEON'
parameters:
	ignoreErrors:
		-
			identifier: isset.variable
			count: 1
			path: app/Dav/Storage/FlysystemFile.php

		-
			identifier: larastan.noEnvCallsOutsideOfConfig
			count: 2
			path: app/Services/MailDelivery/MailDeliveryTestSendRateLimiter.php
NEON);

        $this->assertNull($parsed['error']);
        $this->assertSame(3, $parsed['sum']);
    }

    public function test_parse_rejects_an_entry_without_a_count(): void
    {
        $parsed = phpstan_baseline_parse(<<<'NEON'
parameters:
	ignoreErrors:
		-
			identifier: isset.variable
			path: app/Dav/Storage/FlysystemFile.php
NEON);

        $this->assertSame('phpstan-baseline.neon entries must each have a count: line', $parsed['error']);
        $this->assertNull($parsed['sum']);
    }

    public function test_shrink_error_allows_a_missing_base_and_a_lower_or_equal_sum(): void
    {
        $this->assertNull(phpstan_baseline_shrink_error(null, 5));
        $this->assertNull(phpstan_baseline_shrink_error(5, 5));
        $this->assertNull(phpstan_baseline_shrink_error(5, 4));
    }

    public function test_shrink_error_rejects_a_higher_sum(): void
    {
        $error = phpstan_baseline_shrink_error(5, 6);

        $this->assertNotNull($error);
        $this->assertStringContainsString('rose from 5 to 6', $error);
    }

    public function test_git_show_kind_distinguishes_a_missing_baseline_from_an_unknown_ref(): void
    {
        $this->assertSame(
            'missing-path',
            phpstan_baseline_git_show_kind("fatal: path 'packages/api/phpstan-baseline.neon' does not exist in 'origin/main'"),
        );
        $this->assertSame(
            'unknown-ref',
            phpstan_baseline_git_show_kind("fatal: invalid object name 'origin/main'"),
        );
    }
}

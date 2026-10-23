<?php

declare(strict_types=1);

namespace Tests\Unit\Jmap;

use App\Services\Jmap\Blobs\JmapBlobLimits;
use Tests\TestCase;

/**
 * Limit derivation (#1500): maxSizeUpload is the smaller of the config value
 * and post_max_size, the step budget follows max_execution_time, and
 * maxDataSources never drops below 1 nor the RFC floor of 64.
 */
final class JmapBlobLimitsTest extends TestCase
{
    private string $previousTimeLimit = '0';

    protected function setUp(): void
    {
        parent::setUp();
        $this->previousTimeLimit = (string) ini_get('max_execution_time');
    }

    protected function tearDown(): void
    {
        ini_set('max_execution_time', $this->previousTimeLimit);
        parent::tearDown();
    }

    public function test_max_size_upload_is_the_smaller_of_config_and_post_max_size(): void
    {
        config(['wgw.jmap.max_size_upload' => 25_000_000]);

        $this->assertSame(8 * 1024 * 1024, JmapBlobLimits::maxSizeUpload('8M'));
        $this->assertSame(25_000_000, JmapBlobLimits::maxSizeUpload('64M'));
    }

    public function test_post_max_size_zero_or_unlimited_is_ignored(): void
    {
        config(['wgw.jmap.max_size_upload' => 25_000_000]);

        $this->assertSame(25_000_000, JmapBlobLimits::maxSizeUpload('0'));
        $this->assertSame(25_000_000, JmapBlobLimits::maxSizeUpload(''));
    }

    public function test_step_budget_follows_max_execution_time(): void
    {
        config(['wgw.jmap.step_time_share' => 0.5, 'wgw.jmap.step_throughput_bytes' => 8 * 1024 * 1024]);

        ini_set('max_execution_time', '30');
        $this->assertSame(120 * 1024 * 1024, JmapBlobLimits::stepBudgetBytes());

        ini_set('max_execution_time', '0');
        config(['wgw.jmap.step_unlimited_seconds' => 60]);
        $this->assertSame(240 * 1024 * 1024, JmapBlobLimits::stepBudgetBytes());
    }

    public function test_max_data_sources_has_the_rfc_floor_and_a_ceiling(): void
    {
        ini_set('max_execution_time', '30');
        config(['wgw.jmap.step_time_share' => 0.5, 'wgw.jmap.step_throughput_bytes' => 8 * 1024 * 1024]);

        // A budget that covers fewer than 64 parts still advertises 64.
        config(['wgw.jmap.max_size_upload' => 100 * 1024 * 1024]);
        $this->assertSame(64, JmapBlobLimits::maxDataSources());

        // Never 0, even when one part is larger than the whole budget.
        config(['wgw.jmap.max_size_upload' => PHP_INT_MAX]);
        $this->assertSame(64, JmapBlobLimits::maxDataSources());

        // Tiny parts are capped.
        config(['wgw.jmap.max_size_upload' => 1]);
        $this->assertSame(JmapBlobLimits::MAX_DATA_SOURCES, JmapBlobLimits::maxDataSources());
    }

    public function test_max_size_blob_set_defaults_to_4_gb_and_can_be_unlimited(): void
    {
        config(['wgw.jmap.max_size_blob_set' => 4_000_000_000]);
        $this->assertSame(4_000_000_000, JmapBlobLimits::maxSizeBlobSet());

        config(['wgw.jmap.max_size_blob_set' => 'null']);
        $this->assertNull(JmapBlobLimits::maxSizeBlobSet());
    }
}

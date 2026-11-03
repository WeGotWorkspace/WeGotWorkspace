<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\ReleaseVersion;
use PHPUnit\Framework\TestCase;

final class ReleaseVersionTest extends TestCase
{
    public function test_orders_versions_like_setup_sh_and_the_publish_script(): void
    {
        $ascending = [
            '0.0.0-dev',
            '0.1.121',
            '0.1.122-beta.1',
            '0.1.122-beta.2',
            '0.1.122-beta.10',
            '0.1.122-edge.5',
            '0.1.122-edge.40',
            '0.1.122-rc.1',
            '0.1.122',
            'v0.2.0',
            '1.0.0',
        ];
        for ($i = 1; $i < count($ascending); $i++) {
            $this->assertLessThan(0, ReleaseVersion::compare($ascending[$i - 1], $ascending[$i]), "{$ascending[$i - 1]} < {$ascending[$i]}");
            $this->assertGreaterThan(0, ReleaseVersion::compare($ascending[$i], $ascending[$i - 1]), "{$ascending[$i]} > {$ascending[$i - 1]}");
        }
        $this->assertSame(0, ReleaseVersion::compare('v1.2.3', '1.2.3+abc'));
    }

    public function test_a_newer_release_is_an_upgrade(): void
    {
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.123', '0.1.122'));
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.123-beta.1', '0.1.122'));
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.122', '0.0.0-dev'));
        $this->assertFalse(ReleaseVersion::isUpgrade('0.1.122', '0.1.122'));
        $this->assertFalse(ReleaseVersion::isUpgrade('0.1.121', '0.1.122'));
    }

    public function test_an_edge_install_takes_newer_edge_builds_and_the_final_release(): void
    {
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.123-edge.41', '0.1.123-edge.40'));
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.123', '0.1.123-edge.40'));
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.124-beta.1', '0.1.123-edge.40'));
    }

    public function test_an_edge_install_skips_a_beta_or_rc_of_the_same_version(): void
    {
        // Edge builds of 0.1.123 run before and after these tags.
        $this->assertFalse(ReleaseVersion::isUpgrade('0.1.123-rc.1', '0.1.123-edge.40'));
        $this->assertFalse(ReleaseVersion::isUpgrade('0.1.123-beta.1', '0.1.123-edge.40'));
    }

    public function test_a_beta_install_moves_on_to_edge(): void
    {
        $this->assertTrue(ReleaseVersion::isUpgrade('0.1.123-edge.50', '0.1.123-beta.1'));
    }

    public function test_an_unparseable_version_is_never_an_upgrade(): void
    {
        $this->assertFalse(ReleaseVersion::isUpgrade('latest', '0.1.122'));
        $this->assertFalse(ReleaseVersion::isUpgrade('0.1.123', 'dev'));
        $this->assertFalse(ReleaseVersion::isUpgrade('', '0.1.122'));
    }
}

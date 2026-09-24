<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\InstallerEnvChecker;
use Tests\TestCase;

/**
 * php-imap is not an installer check in v0.9. A missing optional row must still
 * never block install or update — allPassed() ignores optional failures.
 */
final class InstallerEnvCheckerTest extends TestCase
{
    public function test_check_all_does_not_warn_about_imap(): void
    {
        $checks = $this->app->make(InstallerEnvChecker::class)->checkAll('sqlite');

        foreach ($checks as $check) {
            $this->assertStringNotContainsStringIgnoringCase('imap', $check['label']);
            $this->assertStringNotContainsStringIgnoringCase('imap', $check['detail']);
        }
    }

    public function test_all_passed_ignores_failing_optional_rows_but_not_required_ones(): void
    {
        $checker = $this->app->make(InstallerEnvChecker::class);
        $requiredOk = ['ok' => true, 'label' => 'PHP version', 'detail' => '8.3'];
        $optionalMissing = ['ok' => false, 'label' => 'Extension: imap (optional)', 'detail' => 'Missing', 'optional' => true];
        $requiredMissing = ['ok' => false, 'label' => 'Extension: pdo', 'detail' => 'Missing'];

        $this->assertTrue($checker->allPassed([$requiredOk, $optionalMissing]));
        $this->assertFalse($checker->allPassed([$requiredOk, $optionalMissing, $requiredMissing]));
    }
}

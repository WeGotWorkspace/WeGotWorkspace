<?php

declare(strict_types=1);

namespace Tests\Unit\Installer;

use App\Services\Installer\InstallerEnvChecker;
use Tests\TestCase;

/**
 * ext-imap is a common shared-hosting gap: the wizard must surface it as an
 * informational row, but a missing optional extension must never block
 * install (InstallerWizardService / ProductionInstallBootstrap) or update
 * compatibility (UpdateRunner) — all three gate on allPassed().
 */
final class InstallerEnvCheckerTest extends TestCase
{
    public function test_check_all_includes_an_optional_imap_row(): void
    {
        $checks = $this->app->make(InstallerEnvChecker::class)->checkAll('sqlite');

        $imap = null;
        foreach ($checks as $check) {
            if ($check['label'] === 'Extension: imap (optional)') {
                $imap = $check;
            }
        }

        $this->assertNotNull($imap, 'imap row missing from installer checks');
        $this->assertTrue($imap['optional'] ?? false);
        $this->assertSame(extension_loaded('imap'), $imap['ok']);
        if (! $imap['ok']) {
            $this->assertStringContainsString('Mail app', $imap['detail']);
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

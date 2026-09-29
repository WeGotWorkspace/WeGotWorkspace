<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;

/**
 * Production headless install via {@code php artisan wgw:install} (Docker migrator or operator).
 */
final class ProductionInstallBootstrap
{
    public function __construct(
        private AppPaths $paths,
        private WgwInstallEnv $installEnv,
        private InstallerEnvChecker $envChecker,
        private InstallerWizardService $wizard,
    ) {}

    /**
     * @return 'installed'|'skipped'|'incomplete'
     */
    public function run(string $webBase = ''): string
    {
        $this->paths->clearStaleInstallLock();

        if ($this->paths->isInstalled()) {
            return 'skipped';
        }

        if (! $this->installEnv->isHeadlessEnabled()) {
            return 'incomplete';
        }

        $plan = $this->installEnv->headlessPlan($webBase);
        if ($plan === null) {
            return 'incomplete';
        }

        /** @var array<string, mixed> $state */
        $state = $plan['state'];
        $driver = (string) ($state['db_driver'] ?? 'sqlite');
        $checks = $this->envChecker->checkAll($driver);
        if (! $this->envChecker->allPassed($checks)) {
            $failed = array_values(array_filter(
                $checks,
                static fn (array $check): bool => ! $check['ok'],
            ));
            $labels = array_map(static fn (array $check): string => (string) $check['label'], $failed);
            throw new \RuntimeException(
                'Install requirements not met: '.implode(', ', $labels),
            );
        }

        $this->wizard->executeInstall($webBase, $state, $plan['payload']);

        return 'installed';
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Installer;

use RuntimeException;

/**
 * Shared environment gates for local-dev seeders (calendars, notes, future apps).
 *
 * Refuses production, Docker/ZIP install channels, and ZIP extracts without a monorepo checkout.
 */
final class DevSeedGuard
{
    public function isAllowed(): bool
    {
        if (app()->environment('testing')) {
            return true;
        }

        if (! app()->environment('local')) {
            return false;
        }

        if (in_array($this->installChannel(), ['docker', 'zip'], true)) {
            return false;
        }

        return $this->isMonorepoCheckout();
    }

    public function assertAllowed(string $subject = 'dev seed data'): void
    {
        if ($this->isAllowed()) {
            return;
        }

        if (! app()->environment(['local', 'testing'])) {
            throw new RuntimeException('Refusing to seed '.$subject.' outside local/testing.');
        }

        if (in_array($this->installChannel(), ['docker', 'zip'], true)) {
            throw new RuntimeException('Refusing to seed '.$subject.' on a '.$this->installChannel().' install channel.');
        }

        throw new RuntimeException('Refusing to seed '.$subject.' outside a monorepo checkout (ZIP extracts stay empty).');
    }

    private function isMonorepoCheckout(): bool
    {
        $dir = rtrim(str_replace('\\', '/', (string) base_path()), '/');
        for ($i = 0; $i < 5; $i++) {
            if (is_file($dir.'/pnpm-workspace.yaml')) {
                return true;
            }

            $parent = dirname($dir);
            if ($parent === $dir) {
                break;
            }
            $dir = $parent;
        }

        return false;
    }

    private function installChannel(): string
    {
        $configured = config('wgw.install_channel');
        if (is_string($configured) && trim($configured) !== '') {
            return strtolower(trim($configured));
        }

        return strtolower(trim((string) (getenv('WGW_INSTALL_CHANNEL') ?: '')));
    }
}

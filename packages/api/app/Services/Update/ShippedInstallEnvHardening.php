<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Services\Installer\EnvFileWriter;
use App\Support\WgwApiEnvFile;
use App\Support\WgwInstallConfig;

/**
 * One-time rewrite of shipped APP_ENV / APP_DEBUG for ZIP and Docker installs.
 *
 * Channel is read the same way as DevSeedGuard::installChannel():
 * config first, then WGW_INSTALL_CHANNEL. Source checkouts are left alone.
 */
final class ShippedInstallEnvHardening
{
    public function __construct(
        private WgwInstallConfig $install,
        private EnvFileWriter $envFiles,
    ) {}

    public function apply(): bool
    {
        if (! in_array($this->installChannel(), ['zip', 'docker'], true)) {
            return false;
        }

        $path = $this->install->apiEnvPath();
        if (! is_file($path)) {
            return false;
        }

        return $this->envFiles->update($path, static function (string $content): ?string {
            $next = $content;
            if (WgwApiEnvFile::readValue($next, 'APP_ENV') === 'local') {
                $next = WgwApiEnvFile::setLine($next, 'APP_ENV', 'production', quote: false);
            }
            if (WgwApiEnvFile::readValue($next, 'APP_DEBUG') === 'true') {
                $next = WgwApiEnvFile::setLine($next, 'APP_DEBUG', 'false', quote: false);
            }

            return $next === $content ? null : $next;
        });
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

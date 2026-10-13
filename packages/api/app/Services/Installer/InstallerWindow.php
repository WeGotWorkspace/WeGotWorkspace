<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Exceptions\ApiHttpException;
use App\Support\AppPaths;

/**
 * Closes the web installer 30 minutes after the first installer request.
 *
 * Docker headless installs ({@see WgwInstallEnv::isHeadlessEnabled()}) skip
 * this window. The stamp lives outside the document root.
 */
final class InstallerWindow
{
    public const LOCKED_MESSAGE = 'The installer closed 30 minutes after it was first opened. Delete packages/api/storage/app/install-window on the server to reopen it.';

    private const WINDOW_SECONDS = 1800;

    private const RELATIVE_PATH = '/packages/api/storage/app/install-window';

    public function __construct(
        private AppPaths $paths,
        private WgwInstallEnv $installEnv,
    ) {}

    public function assertOpen(): void
    {
        if ($this->installEnv->isHeadlessEnabled()) {
            return;
        }

        $path = $this->paths->installRoot().self::RELATIVE_PATH;
        if (! is_file($path)) {
            $this->write($path, time());

            return;
        }

        $openedAt = $this->openedAt($path);
        if (time() - $openedAt > self::WINDOW_SECONDS) {
            throw new ApiHttpException(423, self::LOCKED_MESSAGE, 'installer_locked');
        }
    }

    private function openedAt(string $path): int
    {
        $raw = file_get_contents($path);
        if (! is_string($raw) || strlen($raw) > 32) {
            throw new ApiHttpException(423, self::LOCKED_MESSAGE, 'installer_locked');
        }

        $trimmed = trim($raw);
        if (preg_match('/\A[1-9][0-9]{0,18}\z/', $trimmed) !== 1) {
            throw new ApiHttpException(423, self::LOCKED_MESSAGE, 'installer_locked');
        }

        return intval($trimmed, 10);
    }

    private function write(string $path, int $openedAt): void
    {
        $dir = dirname($path);
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new \RuntimeException('Could not create the installer window directory.');
        }

        if (file_put_contents($path, $openedAt."\n", LOCK_EX) === false) {
            throw new \RuntimeException('Could not write the installer window.');
        }
    }
}

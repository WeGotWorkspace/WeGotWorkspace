<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Exceptions\ApiHttpException;
use App\Support\AppPaths;

/**
 * Closes the web installer 30 minutes after the first installer action.
 *
 * Docker headless installs ({@see WgwInstallEnv::isHeadlessEnabled()}) skip
 * this window. Reading bootstrap does not start the clock. The stamp lives
 * in the data directory, inside the web root. Managed deny rules answer 404
 * for that tree (RedirectMatch for wgw-content, wgw-plugins, and packages).
 */
final class InstallerWindow
{
    private const WINDOW_SECONDS = 1800;

    private const STAMP_NAME = '.install-window';

    public function __construct(
        private AppPaths $paths,
        private WgwInstallEnv $installEnv,
    ) {}

    public function lockedMessage(): string
    {
        return 'The installer closed 30 minutes after it was first opened. Delete '.$this->stampPath().' on the server to reopen it.';
    }

    /**
     * Start the window when it has not started, then refuse an expired one.
     * A failed write leaves the window open. {@see InstallerEnvChecker} reports that.
     */
    public function open(): void
    {
        if ($this->installEnv->isHeadlessEnabled()) {
            return;
        }

        $path = $this->stampPath();
        if (! is_file($path)) {
            $this->write($path, time());
        }

        $this->assertNotExpired();
    }

    /**
     * Refuse an expired window. A missing stamp means the window has not started.
     */
    public function assertNotExpired(): void
    {
        if ($this->installEnv->isHeadlessEnabled()) {
            return;
        }

        $path = $this->stampPath();
        if (! is_file($path)) {
            return;
        }

        $openedAt = $this->openedAt($path);
        if (time() - $openedAt > self::WINDOW_SECONDS) {
            throw new ApiHttpException(423, $this->lockedMessage(), 'installer_locked');
        }
    }

    public function stampPath(): string
    {
        return rtrim($this->paths->dataDir(), '/').'/'.self::STAMP_NAME;
    }

    /**
     * The data directory must accept the stamp. The requirements screen uses this.
     */
    public function canRecord(): bool
    {
        $dir = dirname($this->stampPath());
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return false;
        }

        return is_dir($dir) && is_writable($dir);
    }

    private function openedAt(string $path): int
    {
        $raw = file_get_contents($path);
        if (! is_string($raw) || strlen($raw) > 32) {
            throw new ApiHttpException(423, $this->lockedMessage(), 'installer_locked');
        }

        $trimmed = trim($raw);
        if (preg_match('/\A[1-9][0-9]{0,18}\z/', $trimmed) !== 1) {
            throw new ApiHttpException(423, $this->lockedMessage(), 'installer_locked');
        }

        return intval($trimmed, 10);
    }

    private function write(string $path, int $openedAt): void
    {
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return;
        }

        if (@file_put_contents($path, $openedAt."\n", LOCK_EX) === false) {
            return;
        }

        @chmod($path, 0600);
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Support\AppPaths;
use App\Support\InstallLayout;
use App\Support\WgwEnvLocation;
use App\Support\WgwInstallConfig;
use Illuminate\Support\Facades\Log;

/**
 * Moves a fresh install's packages/api/.env into its data directory when that
 * directory is outside the published tree (#1484).
 *
 * Runs once, at the end of a fresh install. Existing installs are never moved
 * (INSTALL.md has the manual steps). The .env stays where it is, and the
 * standing data-directory warning covers it, whenever any of these hold:
 * not a release tree, Docker (its .env is a link into the config volume), an
 * operator already chose a location, the data directory is published, or a
 * file already sits at the target.
 *
 * Order keeps the install bootable at every step: copy, verify, write the
 * pointer, verify, then remove the in-tree file.
 */
final class EnvFileRelocator
{
    public const FILE_NAME = 'api.env';

    public const MOVED = 'moved';

    /**
     * Outcomes where the move was attempted and did not finish cleanly; the
     * others are a deliberate choice to leave the .env in place.
     *
     * @var list<string>
     */
    public const FAILURES = ['source_unreadable', 'target_unwritable', 'pointer_unwritable', 'source_left'];

    public function __construct(
        private AppPaths $paths,
        private WgwInstallConfig $installConfig,
        private DataDirCandidateResolver $dataDirs,
        private EnvFileWriter $envFiles = new EnvFileWriter,
    ) {}

    /**
     * The install's last step. Never fails the install: on any problem the
     * .env stays in packages/api, where it was during the install.
     */
    public function relocateAfterInstall(): void
    {
        try {
            $result = $this->relocateIntoDataDir();
        } catch (\Throwable $e) {
            Log::error('installer.env_relocation_failed', ['error' => $e->getMessage()]);

            return;
        }
        if (in_array($result['status'], self::FAILURES, true)) {
            Log::error('installer.env_relocation_failed', $result);

            return;
        }
        Log::info('installer.env_location', $result);
    }

    /**
     * @return array{status: string, path: string}
     */
    public function relocateIntoDataDir(): array
    {
        $installRoot = rtrim(str_replace('\\', '/', $this->paths->installRoot()), '/');
        $apiRoot = $installRoot.'/packages/api';
        $source = WgwEnvLocation::defaultFile($apiRoot);

        $skip = $this->skipReason($installRoot, $apiRoot, $source);
        if ($skip !== null) {
            return ['status' => $skip, 'path' => $source];
        }

        $dataDir = $this->dataDirs->absolutePath($this->paths->dataDir());
        $target = $dataDir.'/'.self::FILE_NAME;
        if (file_exists($target) || is_link($target)) {
            return ['status' => 'target_exists', 'path' => $source];
        }

        $content = @file_get_contents($source);
        if (! is_string($content) || $content === '') {
            return ['status' => 'source_unreadable', 'path' => $source];
        }

        try {
            $this->envFiles->rewrite($target, static fn (string $current): string => $content);
        } catch (\RuntimeException) {
            $this->removeQuietly($target);

            return ['status' => 'target_unwritable', 'path' => $source];
        }
        @unlink($target.'.lock');
        $this->copyOwner($source, $target);
        if (@file_get_contents($target) !== $content) {
            $this->removeQuietly($target);

            return ['status' => 'target_unwritable', 'path' => $source];
        }

        $pointer = WgwEnvLocation::pointerPath($apiRoot);
        if (! $this->writePointer($pointer, $target) || ! $this->pointerResolvesTo($apiRoot, $target)) {
            $this->removeQuietly($pointer);
            $this->removeQuietly($target);

            return ['status' => 'pointer_unwritable', 'path' => $source];
        }

        if (! @unlink($source)) {
            // The install boots from the new file; the old copy is unused but
            // still holds the secrets, so the caller reports it.
            return ['status' => 'source_left', 'path' => $target];
        }
        @unlink($source.'.lock');

        return ['status' => self::MOVED, 'path' => $target];
    }

    private function skipReason(string $installRoot, string $apiRoot, string $source): ?string
    {
        if (! InstallLayout::isReleaseInstallRoot($installRoot)) {
            return 'not_release_tree';
        }
        if ($this->installConfig->installChannel() === 'docker') {
            return 'docker';
        }
        if (WgwEnvLocation::relocated($apiRoot) !== null) {
            return 'already_relocated';
        }
        if (is_link($source)) {
            return 'symlink';
        }
        if (! is_file($source)) {
            return 'source_missing';
        }
        $dataDir = $this->paths->dataDir();
        if (! is_dir($dataDir)
            || $this->dataDirs->isInsidePublishedTree($dataDir, $this->dataDirs->serverDocumentRoot())) {
            return 'data_dir_published';
        }

        return null;
    }

    private function writePointer(string $pointer, string $target): bool
    {
        $tmp = $pointer.'.tmp.'.bin2hex(random_bytes(4));
        if (@file_put_contents($tmp, WgwEnvLocation::pointerContents($target), LOCK_EX) === false) {
            @unlink($tmp);

            return false;
        }
        @chmod($tmp, 0644);
        if (! @rename($tmp, $pointer)) {
            @unlink($tmp);

            return false;
        }

        return true;
    }

    private function pointerResolvesTo(string $apiRoot, string $target): bool
    {
        try {
            return WgwEnvLocation::relocatedForBoot($apiRoot) === $target;
        } catch (\RuntimeException) {
            return false;
        }
    }

    /**
     * A headless install may run as root; the web server must still read the
     * file, as it read the one it replaces.
     */
    private function copyOwner(string $source, string $target): void
    {
        $owner = @fileowner($source);
        $group = @filegroup($source);
        if (is_int($owner) && $owner !== @fileowner($target) && function_exists('chown')) {
            @chown($target, $owner);
        }
        if (is_int($group) && $group !== @filegroup($target) && function_exists('chgrp')) {
            @chgrp($target, $group);
        }
    }

    private function removeQuietly(string $path): void
    {
        if (is_file($path) || is_link($path)) {
            @unlink($path);
        }
    }
}

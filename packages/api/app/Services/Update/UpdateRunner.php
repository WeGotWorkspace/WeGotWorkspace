<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Exceptions\ApiHttpException;
use App\Models\AppUpdateHistory;
use App\Services\Installer\ApiRuntimeEnvService;
use App\Services\Installer\InstallerEnvChecker;
use App\Services\Installer\WgwConfigMigrator;
use App\Services\Installer\WgwSchemaMigrator;
use App\Support\AppVersion;
use App\Support\WgwInstallConfig;
use Illuminate\Support\Facades\DB;

final class UpdateRunner
{
    use UpdateRunnerPackageIo;
    use UpdateRunnerFilesystem;
    use UpdateRunnerBackupArchive;

    /** Orphan progress in state.json without a lock is cleared after this many seconds. */
    private const STALE_PROGRESS_SECONDS = 120;

    public function __construct(
        private UpdateStateStore $store,
        private WgwInstallConfig $install,
        private AppVersion $appVersion,
        private InstallerEnvChecker $envChecker,
        private ReleaseFeedClient $releaseFeed,
        private ApiRuntimeEnvService $apiEnv,
        private WgwSchemaMigrator $schemaMigrator,
        private WgwConfigMigrator $configMigrator,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function getState(): array
    {
        $installChannel = $this->install->installChannel();
        if ($installChannel === 'docker') {
            $this->recoverDockerAbandonedUpdateState();
        }
        $this->recoverStaleLockState();
        $state = $this->store->read();
        $latest = isset($state['latest']) && is_array($state['latest']) ? $state['latest'] : null;
        $hasRequiredMetadata = self::hasRequiredReleaseMetadata($latest);
        $driver = $this->wgwDriver();
        $checks = $this->envChecker->checkAll($driver === 'mysql' ? 'mysql' : 'sqlite');
        $compatible = $this->envChecker->allPassed($checks);
        $checks = array_merge($checks, self::capacityChecks($this->install->installRoot()));
        $lockHeld = is_file($this->store->absolutePath($this->store->lockPath()));
        $phase = self::phaseFromState($state);
        $inProgress = $lockHeld || $phase !== null;
        $current = $inProgress && is_array($state['current'] ?? null) ? $state['current'] : null;
        $installedVersion = $this->appVersion->current();
        if (
            $installChannel !== 'docker'
            && $inProgress
            && is_array($current)
            && is_string($current['from'] ?? null)
            && trim((string) $current['from']) !== ''
        ) {
            $installedVersion = trim((string) $current['from']);
        }

        $response = [
            'installChannel' => $installChannel,
            'installedVersion' => $installedVersion,
            'schemaVersion' => $this->schemaMigrator->currentVersion(),
            'latest' => $latest,
            'updateAvailable' => $hasRequiredMetadata && self::isUpdateAvailable($installedVersion, $latest),
            'compatible' => $compatible,
            'backups' => self::listBackups(),
            'checks' => $checks,
            'inProgress' => $inProgress,
            'phase' => $phase,
            'current' => $current,
            'download' => $inProgress && is_array($state['download'] ?? null) ? $state['download'] : null,
            'phaseProgress' => $inProgress && is_array($state['phase_progress'] ?? null) ? $state['phase_progress'] : null,
            'cancelRequested' => $inProgress && (bool) ($state['cancel_requested'] ?? false),
            'cancelAllowed' => $phase !== null && self::isCancellablePhase($phase),
            'lastCheckedAt' => is_string($state['last_checked_at'] ?? null) ? $state['last_checked_at'] : null,
            'lastCheckError' => is_string($state['last_check_error'] ?? null) ? $state['last_check_error'] : null,
            'lastResult' => is_array($state['last_result'] ?? null) ? $state['last_result'] : null,
        ];
        if ($installChannel === 'docker') {
            $imageTag = self::dockerImageTagFromEnv();
            if ($imageTag !== null) {
                $response['imageTag'] = $imageTag;
            }
        }

        return $response;
    }

    public function recoverDockerAbandonedUpdateState(): void
    {
        if ($this->install->installChannel() !== 'docker') {
            return;
        }

        $lockPath = $this->store->absolutePath($this->store->lockPath());
        $maintenancePath = $this->store->absolutePath($this->store->maintenancePath());
        $state = $this->store->read();
        $hasProgress = self::phaseFromState($state) !== null
            || is_array($state['current'] ?? null)
            || is_file($lockPath)
            || is_file($maintenancePath);

        if (! $hasProgress) {
            return;
        }

        if (is_file($lockPath)) {
            @unlink($lockPath);
        }
        @unlink($maintenancePath);
        $this->store->clearCancelRequest();
        self::clearProgressFields($state);
        $this->store->write($state);
        $this->store->appendLog('Cleared abandoned update state on Docker channel (web updater disabled).');
    }

    public function recoverStaleLockState(): void
    {
        $lockPath = $this->store->absolutePath($this->store->lockPath());
        $maintenancePath = $this->store->absolutePath($this->store->maintenancePath());

        if (! is_file($lockPath)) {
            if (is_file($maintenancePath)) {
                @unlink($maintenancePath);
                $this->store->clearCancelRequest();
                $state = $this->store->read();
                self::clearProgressFields($state);
                $this->store->write($state);
                $this->store->appendLog('Recovered stale maintenance mode marker without active update lock.');
            } else {
                $state = $this->store->read();
                if (self::phaseFromState($state) !== null && self::isStaleProgressState($state)) {
                    self::clearProgressFields($state);
                    $this->store->write($state);
                    $this->store->appendLog('Cleared orphaned update progress (no active lock).');
                }
            }

            return;
        }
        $lock = @fopen($lockPath, 'c+');
        if (! is_resource($lock)) {
            return;
        }
        $acquired = @flock($lock, LOCK_EX | LOCK_NB);
        if ($acquired !== true) {
            fclose($lock);

            return;
        }

        flock($lock, LOCK_UN);
        fclose($lock);
        @unlink($lockPath);
        @unlink($maintenancePath);
        $this->store->clearCancelRequest();

        $state = $this->store->read();
        self::clearProgressFields($state);
        $this->store->write($state);
        $this->store->appendLog('Recovered stale update lock state.');
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private static function clearProgressFields(array &$state): void
    {
        unset(
            $state['phase'],
            $state['current'],
            $state['download'],
            $state['phase_progress'],
            $state['cancel_requested'],
        );
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private static function phaseFromState(array $state): ?string
    {
        if (! is_string($state['phase'] ?? null)) {
            return null;
        }
        $phase = trim((string) $state['phase']);

        return $phase !== '' ? $phase : null;
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private static function isStaleProgressState(array $state): bool
    {
        if (self::phaseFromState($state) === null) {
            return false;
        }

        $candidates = [];
        if (is_array($state['phase_progress'] ?? null) && is_string($state['phase_progress']['updatedAt'] ?? null)) {
            $candidates[] = strtotime((string) $state['phase_progress']['updatedAt']);
        }
        if (is_array($state['download'] ?? null) && is_string($state['download']['updatedAt'] ?? null)) {
            $candidates[] = strtotime((string) $state['download']['updatedAt']);
        }
        if (is_array($state['current'] ?? null) && is_string($state['current']['at'] ?? null)) {
            $candidates[] = strtotime((string) $state['current']['at']);
        }

        $latest = false;
        foreach ($candidates as $timestamp) {
            if (is_int($timestamp) && $timestamp > 0) {
                $latest = $latest === false ? $timestamp : max($latest, $timestamp);
            }
        }

        if ($latest === false) {
            return true;
        }

        return (time() - $latest) >= self::STALE_PROGRESS_SECONDS;
    }

    /**
     * @return array<string, mixed>
     */
    public function check(string $feedUrl): array
    {
        self::assertWebUpdaterAllowed();
        self::ensureRateLimit('check', 10);
        $state = $this->store->read();
        $state['last_checked_at'] = date('c');
        try {
            $feedUrl = trim($feedUrl);
            if ($feedUrl === '') {
                throw new \InvalidArgumentException('WGW_UPDATE_FEED_URL is not configured.');
            }
            self::assertHttpsUrl($feedUrl, 'Update feed URL');
            $latest = $this->releaseFeed->fetchLatest($feedUrl);
            if (! is_array($latest)) {
                throw new \InvalidArgumentException('No valid release metadata found. Point WGW_UPDATE_FEED_URL to manifest.json or GitHub releases/latest API URL.');
            }
            $state['latest'] = self::normalizeRequiredReleaseMetadata($latest);
            $state['last_check_error'] = null;
        } catch (\Throwable $e) {
            $state['last_check_error'] = $e->getMessage();
            unset($state['latest']);
            $this->store->write($state);
            throw $e;
        }
        $this->store->write($state);

        return $this->getState();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function apply(array $input): array
    {
        self::assertWebUpdaterAllowed();
        self::ensureRateLimit('apply', 30);
        $lock = @fopen($this->store->absolutePath($this->store->lockPath()), 'c+');
        if (! is_resource($lock)) {
            throw new \RuntimeException('Could not create update lock file.');
        }
        if (! flock($lock, LOCK_EX | LOCK_NB)) {
            throw new \RuntimeException('Another update process is already running.');
        }

        $beforeVersion = $this->appVersion->current();
        $release = self::latestFromState();
        $requestedVersion = trim((string) ($input['version'] ?? ''));
        if ($requestedVersion !== '' && ! hash_equals($release['version'], $requestedVersion)) {
            throw new \InvalidArgumentException('Checked release does not match the requested version. Check for updates again.');
        }
        $targetVersion = $release['version'];
        $packageUrl = $release['package_url'];
        $checksum = $release['checksum_sha256'];
        $checksumSignature = $release['checksum_signature'];

        $backupBaseName = self::buildBackupBaseName($beforeVersion, $targetVersion);
        $backupDir = $this->store->absolutePath($this->store->backupDir()).'/'.$backupBaseName;
        $backupArchivePath = $this->store->absolutePath($this->store->backupDir()).'/'.$backupBaseName.'.zip';
        $replacePaths = [
            'index.php',
            'bootstrap',
            'VERSION',
            'wgw-config.sample.php',
            'packages/api',
            'packages/apps',
        ];

        $result = [
            'ok' => false,
            'version' => $targetVersion,
            'message' => '',
            'finishedAt' => null,
        ];

        $applyFinished = false;
        $runner = $this;
        register_shutdown_function(static function () use (
            $runner,
            &$applyFinished,
            &$result,
            &$lock,
            $beforeVersion,
            $targetVersion,
        ): void {
            if ($applyFinished) {
                return;
            }
            $runner->finalizeAbortedApply($result, $lock, $beforeVersion, $targetVersion);
        });

        try {
            $this->store->appendLog('Update started: '.$beforeVersion.' -> '.$targetVersion);
            $this->store->clearCancelRequest();
            self::writeStatus('downloading', $beforeVersion, $targetVersion);
            $this->store->cleanupTemporaryData();
            @mkdir(dirname($this->store->absolutePath($this->store->packageKey())), 0775, true);
            self::downloadPackage($packageUrl, $this->store->absolutePath($this->store->packageKey()), $beforeVersion, $targetVersion);
            self::verifyChecksum($this->store->absolutePath($this->store->packageKey()), $checksum);
            self::verifyChecksumSignature($checksum, $checksumSignature);

            self::writeStatus('extracting', $beforeVersion, $targetVersion);
            self::extractPackage($this->store->absolutePath($this->store->packageKey()), $this->store->absolutePath($this->store->stagingKey()), $beforeVersion, $targetVersion);
            $releaseRoot = self::resolveReleaseRoot($this->store->absolutePath($this->store->stagingKey()));

            self::writeStatus('backing_up', $beforeVersion, $targetVersion);
            @mkdir($backupDir, 0775, true);
            self::backupDatabase($backupDir, $beforeVersion, $targetVersion);
            $this->backupApiEnvFile($backupDir);
            self::throwIfCancelRequested();
            self::assertApplyCapacity($releaseRoot, $this->install->installRoot(), $replacePaths);

            self::writeMaintenanceMode(true);
            self::writeStatus('applying_files', $beforeVersion, $targetVersion);
            self::applyPaths($releaseRoot, $this->install->installRoot(), $replacePaths);
            self::removeLegacySourceTrees($this->install->installRoot());
            file_put_contents($this->install->installRoot().'/VERSION', $targetVersion."\n", LOCK_EX);

            self::writeStatus('running_migrations', $beforeVersion, $targetVersion);
            $this->configMigrator->migrateIfNeeded();
            $this->schemaMigrator->migrate();
            self::recordHistory($beforeVersion, $targetVersion, 'success', 'Update applied successfully.');
            $result['ok'] = true;
            $result['message'] = 'Update applied successfully.';
            $this->store->appendLog('Update finished successfully.');
        } catch (\Throwable $e) {
            $this->store->appendLog('Update failed: '.$e->getMessage());
            $didStartFileSwap = self::didStartApplyingFiles();
            if ($didStartFileSwap) {
                $this->store->appendLog(
                    'Automatic file rollback skipped: updater is configured for database-only backups.'
                );
            }
            self::recordHistory(
                $beforeVersion,
                $targetVersion,
                $e->getMessage() === 'Update cancelled by user.' ? 'cancelled' : 'failed',
                $e->getMessage()
            );
            $result['message'] = $e->getMessage();
            if ($e->getMessage() === 'Update cancelled by user.') {
                return $result;
            }
            throw $e;
        } finally {
            self::writeMaintenanceMode(false);
            if (is_dir($backupDir)) {
                try {
                    self::finalizeBackupArchive($backupDir, $backupArchivePath, $beforeVersion, $targetVersion);
                } catch (\Throwable $archiveError) {
                    $this->store->appendLog('Backup archive creation failed: '.$archiveError->getMessage());
                }
            }
            $result['finishedAt'] = date('c');
            $state = $this->store->read();
            $state['last_result'] = $result;
            self::clearProgressFields($state);
            $this->store->write($state);
            @unlink($this->store->absolutePath($this->store->lockPath()));
            if (is_resource($lock)) {
                flock($lock, LOCK_UN);
                fclose($lock);
            }
            $this->store->cleanupTemporaryData();
            $applyFinished = true;
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $result
     */
    private function finalizeAbortedApply(
        array &$result,
        mixed $lock,
        string $beforeVersion,
        string $targetVersion,
    ): void {
        $lockPath = $this->store->absolutePath($this->store->lockPath());
        if (! is_file($lockPath)) {
            return;
        }

        $message = 'Update aborted before completion (request or process ended).';
        $this->store->appendLog($message);
        $result['message'] = $message;
        $result['finishedAt'] = date('c');

        $state = $this->store->read();
        $state['last_result'] = $result;
        self::clearProgressFields($state);
        $this->store->write($state);

        if (is_resource($lock)) {
            flock($lock, LOCK_UN);
            fclose($lock);
        }
        @unlink($lockPath);
        @unlink($this->store->absolutePath($this->store->maintenancePath()));
        $this->store->clearCancelRequest();
        $this->store->cleanupTemporaryData();
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function deleteBackup(array $input): array
    {
        $name = isset($input['name']) && is_string($input['name']) ? trim($input['name']) : '';
        if ($name === '' || ! preg_match('/^[A-Za-z0-9._-]+$/', $name)) {
            throw new \InvalidArgumentException('Invalid backup file name.');
        }
        $path = $this->store->absolutePath($this->store->backupDir()).'/'.$name;
        if (! file_exists($path)) {
            throw new \InvalidArgumentException('Backup not found.');
        }
        if (is_dir($path)) {
            self::rmRecursive($path);
        } elseif (! @unlink($path)) {
            throw new \RuntimeException('Could not delete backup.');
        }

        return $this->getState();
    }

    public function inMaintenanceMode(): bool
    {
        return is_file($this->store->absolutePath($this->store->maintenancePath()));
    }

    /**
     * @return array<string, mixed>
     */
    public function cancel(): array
    {
        $state = $this->store->read();
        if (! is_file($this->store->absolutePath($this->store->lockPath()))) {
            throw new \InvalidArgumentException('No update is currently running.');
        }
        $phase = is_string($state['phase'] ?? null) ? $state['phase'] : '';
        if (! self::isCancellablePhase($phase)) {
            throw new \InvalidArgumentException('Cancellation is no longer available for this update stage.');
        }
        $this->store->requestCancel();
        $state['cancel_requested'] = true;
        $this->store->write($state);
        $this->store->appendLog('Cancellation requested by admin user.');

        return $this->getState();
    }

    private function writeMaintenanceMode(bool $enabled): void
    {
        if ($enabled) {
            $this->store->ensureDirs();
            file_put_contents($this->store->absolutePath($this->store->maintenancePath()), date('c')."\n", LOCK_EX);

            return;
        }
        @unlink($this->store->absolutePath($this->store->maintenancePath()));
    }

    private function isUpdateAvailable(string $installed, ?array $latest): bool
    {
        if ($latest === null) {
            return false;
        }
        $candidate = trim((string) ($latest['version'] ?? ''));
        if ($candidate === '') {
            return false;
        }

        return version_compare(self::normalizeVersion($candidate), self::normalizeVersion($installed), '>');
    }

    private function normalizeVersion(string $version): string
    {
        $trimmed = trim($version);
        if (str_starts_with($trimmed, 'v')) {
            return substr($trimmed, 1);
        }

        return $trimmed;
    }

    private static function dockerImageTagFromEnv(): ?string
    {
        $image = getenv('WGW_IMAGE');
        if (! is_string($image)) {
            return null;
        }
        $image = trim($image);
        if ($image === '') {
            return null;
        }
        $pos = strrpos($image, ':');
        if ($pos === false) {
            return null;
        }
        $tag = trim(substr($image, $pos + 1));

        return $tag !== '' ? $tag : null;
    }

    /**
     * @param  array<string, mixed>|null  $latest
     */
    private function hasRequiredReleaseMetadata(?array $latest): bool
    {
        if ($latest === null) {
            return false;
        }
        try {
            self::normalizeRequiredReleaseMetadata($latest);

            return true;
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * @param  array<string, mixed>  $latest
     * @return array{version: string, package_url: string, checksum_sha256: string, checksum_signature: string}
     */
    private function normalizeRequiredReleaseMetadata(array $latest): array
    {
        $version = self::requiredNonEmptyString($latest, 'version');
        $packageUrl = self::requiredNonEmptyString($latest, 'package_url');
        $checksum = self::requiredNonEmptyString($latest, 'checksum_sha256');
        $checksumSignature = self::requiredNonEmptyString($latest, 'checksum_signature');
        self::assertHttpsUrl($packageUrl, 'Release package URL');

        return [
            'version' => $version,
            'package_url' => $packageUrl,
            'checksum_sha256' => $checksum,
            'checksum_signature' => $checksumSignature,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function requiredNonEmptyString(array $data, string $field): string
    {
        $value = isset($data[$field]) && is_string($data[$field]) ? trim($data[$field]) : '';
        if ($value === '') {
            throw new \InvalidArgumentException('Release metadata is missing required field: '.$field.'.');
        }

        return $value;
    }

    private function assertHttpsUrl(string $url, string $label): void
    {
        $parts = parse_url(trim($url));
        $scheme = is_array($parts) && isset($parts['scheme']) && is_string($parts['scheme'])
            ? strtolower($parts['scheme'])
            : '';
        if ($scheme !== 'https') {
            throw new \InvalidArgumentException($label.' must use HTTPS.');
        }
    }

    private function writeStatus(string $phase, string $fromVersion, string $toVersion): void
    {
        $state = $this->store->read();
        $previousPhase = is_string($state['phase'] ?? null) ? $state['phase'] : null;
        $state['phase'] = $phase;
        $state['current'] = [
            'from' => $fromVersion,
            'to' => $toVersion,
            'at' => date('c'),
        ];
        if ($phase !== 'downloading') {
            unset($state['download']);
        }
        unset($state['phase_progress']);
        $state['cancel_requested'] = $this->store->isCancelRequested();
        $this->store->write($state);
        if ($previousPhase !== $phase) {
            $this->store->appendLog('Stage: '.self::phaseLabel($phase).'.');
        }
    }

    private function writeDownloadProgress(
        string $fromVersion,
        string $toVersion,
        int $downloadedBytes,
        ?int $totalBytes
    ): void {
        $state = $this->store->read();
        $state['phase'] = 'downloading';
        $state['current'] = [
            'from' => $fromVersion,
            'to' => $toVersion,
            'at' => date('c'),
        ];
        $state['download'] = [
            'downloadedBytes' => max(0, $downloadedBytes),
            'totalBytes' => $totalBytes,
            'percent' => $totalBytes !== null && $totalBytes > 0
                ? min(100, max(0, (int) floor(($downloadedBytes / $totalBytes) * 100)))
                : null,
            'updatedAt' => date('c'),
        ];
        $state['cancel_requested'] = $this->store->isCancelRequested();
        unset($state['phase_progress']);
        $this->store->write($state);
    }

    private function writePhaseProgress(
        string $phase,
        string $fromVersion,
        string $toVersion,
        int $completed,
        int $total
    ): void {
        $safeTotal = max(1, $total);
        $safeCompleted = max(0, min($completed, $safeTotal));
        $state = $this->store->read();
        $state['phase'] = $phase;
        $state['current'] = [
            'from' => $fromVersion,
            'to' => $toVersion,
            'at' => date('c'),
        ];
        $state['phase_progress'] = [
            'completed' => $safeCompleted,
            'total' => $safeTotal,
            'percent' => min(100, max(0, (int) floor(($safeCompleted / $safeTotal) * 100))),
            'updatedAt' => date('c'),
        ];
        $state['cancel_requested'] = $this->store->isCancelRequested();
        unset($state['download']);
        $this->store->write($state);
    }

    private function isCancellablePhase(string $phase): bool
    {
        return in_array($phase, ['downloading', 'extracting', 'backing_up'], true);
    }

    private function throwIfCancelRequested(): void
    {
        if (! $this->store->isCancelRequested()) {
            return;
        }
        throw new \RuntimeException('Update cancelled by user.');
    }

    private function didStartApplyingFiles(): bool
    {
        $state = $this->store->read();
        $phase = is_string($state['phase'] ?? null) ? $state['phase'] : '';

        return $phase === 'applying_files' || $phase === 'running_migrations';
    }

    private function parseContentLength(mixed $headers): ?int
    {
        if (! is_array($headers)) {
            return null;
        }
        foreach ($headers as $header) {
            if (! is_string($header)) {
                continue;
            }
            if (preg_match('/^Content-Length:\s*(\d+)/i', $header, $m) !== 1) {
                continue;
            }
            $value = (int) $m[1];
            if ($value > 0) {
                return $value;
            }
        }

        return null;
    }

    private function assertWebUpdaterAllowed(): void
    {
        if ($this->install->installChannel() === 'docker') {
            throw new ApiHttpException(
                403,
                'In-container web updates are disabled on Docker installs. Upgrade with setup.sh on the host.',
                'forbidden',
            );
        }
    }

    private function ensureRateLimit(string $action, int $seconds): void
    {
        $state = $this->store->read();
        $key = 'last_'.$action.'_at';
        $now = time();
        $last = isset($state[$key]) ? strtotime((string) $state[$key]) : false;
        if (is_int($last) && $last > 0 && ($now - $last) < $seconds) {
            throw new \InvalidArgumentException('Please wait before running another update '.$action.'.');
        }
        $state[$key] = date('c');
        $this->store->write($state);
    }

    private function phaseLabel(string $phase): string
    {
        return match ($phase) {
            'downloading' => 'Downloading package',
            'extracting' => 'Extracting archive',
            'backing_up' => 'Creating backup',
            'applying_files' => 'Replacing files',
            'running_migrations' => 'Running migrations',
            default => $phase,
        };
    }

    /**
     * @return list<array{
     *   name: string,
     *   sizeBytes: int,
     *   modifiedAt: string|null,
     *   fromVersion: string|null,
     *   toVersion: string|null,
     *   format: string,
     *   downloadable: bool
     * }>
     */
    private static function recordHistory(
        string $fromVersion,
        string $toVersion,
        string $status,
        string $message
    ): void {
        AppUpdateHistory::query()->create([
            'from_version' => $fromVersion,
            'to_version' => $toVersion,
            'status' => $status,
            'message' => $message,
            'created_at' => date('c'),
        ]);
    }
}

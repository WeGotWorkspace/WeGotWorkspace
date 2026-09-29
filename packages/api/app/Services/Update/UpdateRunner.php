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
    /** Orphan progress in state.json without a lock is cleared after this many seconds. */
    private const STALE_PROGRESS_SECONDS = 120;

    private bool $applyFinished = false;

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

        $this->applyFinished = false;
        $runner = $this;
        register_shutdown_function(static function () use (
            $runner,
            &$result,
            &$lock,
            $beforeVersion,
            $targetVersion,
        ): void {
            if ($runner->applyFinished) {
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
            $this->applyFinished = true;
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

    private function downloadPackage(string $url, string $target, string $fromVersion, string $toVersion): void
    {
        $ctx = stream_context_create([
            'http' => [
                'method' => 'GET',
                'timeout' => 60,
                'ignore_errors' => true,
                'header' => "User-Agent: WeGotWorkspace-Updater/1.0\r\n",
            ],
        ]);
        $input = @fopen($url, 'rb', false, $ctx);
        if (! is_resource($input)) {
            throw new \RuntimeException('Could not download release package.');
        }
        $tmpTarget = $target.'.part';
        $output = @fopen($tmpTarget, 'wb');
        if (! is_resource($output)) {
            fclose($input);
            throw new \RuntimeException('Could not write downloaded package.');
        }
        $meta = stream_get_meta_data($input);
        $totalBytes = self::parseContentLength($meta['wrapper_data'] ?? null);
        $downloadedBytes = 0;
        $lastProgressWriteAt = 0.0;
        self::writeDownloadProgress($fromVersion, $toVersion, $downloadedBytes, $totalBytes);

        try {
            while (! feof($input)) {
                self::throwIfCancelRequested();
                $chunk = fread($input, 1024 * 1024);
                if ($chunk === false) {
                    throw new \RuntimeException('Could not download release package.');
                }
                if ($chunk === '') {
                    continue;
                }
                $written = fwrite($output, $chunk);
                if ($written === false) {
                    throw new \RuntimeException('Could not write downloaded package.');
                }
                $downloadedBytes += $written;
                $now = microtime(true);
                if (($now - $lastProgressWriteAt) >= 0.2 || ($totalBytes !== null && $downloadedBytes >= $totalBytes)) {
                    self::writeDownloadProgress($fromVersion, $toVersion, $downloadedBytes, $totalBytes);
                    $lastProgressWriteAt = $now;
                }
            }
        } finally {
            fclose($input);
            fclose($output);
        }

        if ($downloadedBytes <= 0) {
            @unlink($tmpTarget);
            throw new \RuntimeException('Could not download release package.');
        }
        if ($totalBytes !== null && $downloadedBytes < $totalBytes) {
            @unlink($tmpTarget);
            throw new \RuntimeException('Downloaded package is incomplete.');
        }
        self::throwIfCancelRequested();
        if (! @rename($tmpTarget, $target)) {
            @unlink($tmpTarget);
            throw new \RuntimeException('Could not write downloaded package.');
        }
        self::writeDownloadProgress($fromVersion, $toVersion, $downloadedBytes, $downloadedBytes);
    }

    private function verifyChecksum(string $path, string $expected): void
    {
        $actual = hash_file('sha256', $path);
        if (! is_string($actual) || ! hash_equals(strtolower($expected), strtolower($actual))) {
            throw new \RuntimeException('Release checksum verification failed.');
        }
    }

    private function verifyChecksumSignature(string $checksum, string $signature): void
    {
        if (! function_exists('openssl_verify')) {
            throw new \RuntimeException('OpenSSL extension is required for signature verification.');
        }
        $publicKeyPath = dirname(__DIR__, 3).'/resources/update/update-public-key.pem';
        if (! is_readable($publicKeyPath)) {
            throw new \RuntimeException('Missing update public key for signature verification.');
        }
        $publicKey = trim((string) file_get_contents($publicKeyPath));
        if ($publicKey === '' || str_contains($publicKey, 'REPLACE_WITH_RELEASE_SIGNING_PUBLIC_KEY')) {
            throw new \RuntimeException('Update public key is not configured.');
        }
        $decodedSig = base64_decode($signature, true);
        if ($decodedSig === false) {
            throw new \RuntimeException('Invalid update signature format.');
        }
        $ok = openssl_verify($checksum, $decodedSig, $publicKey, OPENSSL_ALGO_SHA256);
        if ($ok !== 1) {
            throw new \RuntimeException('Release signature verification failed.');
        }
    }

    /**
     * @return array{version: string, package_url: string, checksum_sha256: string, checksum_signature: string}
     */
    private function latestFromState(): array
    {
        $state = $this->store->read();
        $latest = isset($state['latest']) && is_array($state['latest']) ? $state['latest'] : null;
        if ($latest === null) {
            throw new \RuntimeException('No checked update metadata found. Run Check now first.');
        }

        return self::normalizeRequiredReleaseMetadata($latest);
    }

    private function extractPackage(string $zipPath, string $targetDir, string $fromVersion, string $toVersion): void
    {
        self::rmRecursive($targetDir);
        @mkdir($targetDir, 0775, true);
        $zip = new \ZipArchive;
        if ($zip->open($zipPath) !== true) {
            throw new \RuntimeException('Could not open release ZIP.');
        }
        $total = $zip->numFiles;
        if ($total <= 0) {
            $zip->close();
            throw new \RuntimeException('Release ZIP is empty.');
        }
        self::writePhaseProgress('extracting', $fromVersion, $toVersion, 0, $total);
        $done = 0;
        for ($i = 0; $i < $total; $i++) {
            self::throwIfCancelRequested();
            $name = $zip->getNameIndex($i);
            if (! is_string($name) || $name === '') {
                continue;
            }
            if (! $zip->extractTo($targetDir, [$name])) {
                $zip->close();
                throw new \RuntimeException('Could not extract release ZIP.');
            }
            $done++;
            self::writePhaseProgress('extracting', $fromVersion, $toVersion, $done, $total);
        }
        $zip->close();
    }

    private function resolveReleaseRoot(string $stagingDir): string
    {
        $items = scandir($stagingDir);
        if (! is_array($items)) {
            return $stagingDir;
        }
        $entries = array_values(array_filter($items, static fn (string $v): bool => $v !== '.' && $v !== '..'));
        if (count($entries) === 1) {
            $only = $stagingDir.'/'.$entries[0];
            if (is_dir($only)) {
                return $only;
            }
        }

        return $stagingDir;
    }

    private function backupDatabase(
        string $backupRoot,
        string $fromVersion,
        string $toVersion
    ): void {
        self::writePhaseProgress('backing_up', $fromVersion, $toVersion, 0, 1);
        $driver = $this->wgwDriver();
        if ($driver === 'sqlite') {
            $pdo = DB::connection('wgw')->getPdo();
            $sqlitePath = self::resolveSqlitePathFromPdo($pdo);
            if ($sqlitePath === null || ! is_file($sqlitePath)) {
                throw new \RuntimeException('Could not locate SQLite database file for backup.');
            }
            $dest = $backupRoot.'/database.sqlite';
            if (! @copy($sqlitePath, $dest)) {
                $reason = self::lastFilesystemError();
                throw new \RuntimeException(
                    'Could not create SQLite backup: '.$sqlitePath.' -> '.$dest.($reason !== '' ? ' ('.$reason.')' : '')
                );
            }
            self::writePhaseProgress('backing_up', $fromVersion, $toVersion, 1, 1);

            return;
        }
        if ($driver === 'mysql') {
            $dest = $backupRoot.'/database.sql';
            self::exportMysqlDatabase(DB::connection('wgw')->getPdo(), $dest);
            self::writePhaseProgress('backing_up', $fromVersion, $toVersion, 1, 1);

            return;
        }
        throw new \RuntimeException('Database backup is not supported for PDO driver: '.$driver);
    }

    private function wgwDriver(): string
    {
        return DB::connection('wgw')->getDriverName();
    }

    private function resolveSqlitePathFromPdo(\PDO $pdo): ?string
    {
        $stmt = $pdo->query('PRAGMA database_list');
        if (! $stmt instanceof \PDOStatement) {
            return null;
        }
        $rows = $stmt->fetchAll(\PDO::FETCH_ASSOC);
        foreach ($rows as $row) {
            $name = isset($row['name']) && is_string($row['name']) ? $row['name'] : '';
            $file = isset($row['file']) && is_string($row['file']) ? trim($row['file']) : '';
            if ($name === 'main' && $file !== '') {
                return $file;
            }
        }

        return null;
    }

    private function exportMysqlDatabase(\PDO $pdo, string $destPath): void
    {
        $dbNameStmt = $pdo->query('SELECT DATABASE()');
        $dbName = $dbNameStmt instanceof \PDOStatement ? (string) ($dbNameStmt->fetchColumn() ?: '') : '';
        if ($dbName === '') {
            throw new \RuntimeException('Could not determine current MySQL database name for backup.');
        }
        $out = @fopen($destPath, 'wb');
        if (! is_resource($out)) {
            $reason = self::lastFilesystemError();
            throw new \RuntimeException(
                'Could not create MySQL backup file: '.$destPath.($reason !== '' ? ' ('.$reason.')' : '')
            );
        }
        try {
            fwrite($out, "-- WeGotWorkspace MySQL backup\n");
            fwrite($out, '-- Generated at '.date('c')."\n");
            fwrite($out, '-- Database: '.$dbName."\n\n");
            fwrite($out, "SET FOREIGN_KEY_CHECKS=0;\n\n");

            $tablesStmt = $pdo->query('SHOW FULL TABLES WHERE Table_type = "BASE TABLE"');
            if (! $tablesStmt instanceof \PDOStatement) {
                throw new \RuntimeException('Could not enumerate MySQL tables for backup.');
            }
            $tables = $tablesStmt->fetchAll(\PDO::FETCH_NUM);
            foreach ($tables as $tableRow) {
                $table = isset($tableRow[0]) ? (string) $tableRow[0] : '';
                if ($table === '') {
                    continue;
                }
                $tableIdent = self::quoteMysqlIdentifier($table);
                $createStmt = $pdo->query('SHOW CREATE TABLE '.$tableIdent);
                if (! $createStmt instanceof \PDOStatement) {
                    throw new \RuntimeException('Could not read CREATE TABLE for '.$table);
                }
                $createRow = $createStmt->fetch(\PDO::FETCH_NUM);
                $createSql = isset($createRow[1]) && is_string($createRow[1]) ? $createRow[1] : '';
                if ($createSql === '') {
                    throw new \RuntimeException('Could not parse CREATE TABLE statement for '.$table);
                }
                fwrite($out, '-- Table: '.$table."\n");
                fwrite($out, 'DROP TABLE IF EXISTS '.$tableIdent.";\n");
                fwrite($out, $createSql.";\n\n");

                $rowsStmt = $pdo->query('SELECT * FROM '.$tableIdent);
                if (! $rowsStmt instanceof \PDOStatement) {
                    throw new \RuntimeException('Could not read rows from '.$table.' for backup.');
                }
                while (($row = $rowsStmt->fetch(\PDO::FETCH_ASSOC)) !== false) {
                    $columns = array_map(
                        static fn (string $column): string => self::quoteMysqlIdentifier($column),
                        array_keys($row)
                    );
                    $values = array_map(
                        static fn ($value): string => self::sqlLiteral($pdo, $value),
                        array_values($row)
                    );
                    fwrite(
                        $out,
                        'INSERT INTO '.$tableIdent.' ('.implode(', ', $columns).') VALUES ('.implode(', ', $values).");\n"
                    );
                }
                fwrite($out, "\n");
            }

            fwrite($out, "SET FOREIGN_KEY_CHECKS=1;\n");
        } finally {
            fclose($out);
        }
    }

    private static function quoteMysqlIdentifier(string $value): string
    {
        return '`'.str_replace('`', '``', $value).'`';
    }

    private static function sqlLiteral(\PDO $pdo, mixed $value): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if (is_bool($value)) {
            return $value ? '1' : '0';
        }
        if (is_int($value) || is_float($value)) {
            return (string) $value;
        }
        if (is_resource($value)) {
            $value = stream_get_contents($value);
        }
        $quoted = $pdo->quote((string) $value);

        return is_string($quoted) ? $quoted : "''";
    }

    /**
     * @param  list<string>  $paths
     */
    private function applyPaths(string $sourceRoot, string $targetRoot, array $paths): void
    {
        $preservation = new ApiPackageLocalPreservation;

        foreach ($paths as $relative) {
            $src = $sourceRoot.'/'.$relative;
            if (! file_exists($src)) {
                continue;
            }
            $dest = $targetRoot.'/'.$relative;
            $preserved = $relative === 'packages/api'
                ? $preservation->snapshot($dest)
                : ['files' => [], 'dirs' => [], 'tempBase' => null];
            $hadLocalState = $preserved['files'] !== [] || $preserved['dirs'] !== [];
            self::rmRecursive($dest);
            self::copyRecursive($src, $dest);
            if ($relative === 'packages/api') {
                if ($hadLocalState) {
                    $preservation->restore($dest, $preserved);
                    $this->store->appendLog('Preserved install-local packages/api state (.env, logs, sessions).');
                } else {
                    $preservation->cleanupSnapshot($preserved);
                }
                $envResult = $this->apiEnv->ensure($targetRoot, ApiRuntimeEnvService::guessRequestAppUrl());
                if ($envResult['createdEnv']) {
                    $this->store->appendLog('Created packages/api/.env from .env.example.');
                }
                if ($envResult['generatedKey']) {
                    $this->store->appendLog('Generated APP_KEY in packages/api/.env.');
                }
                if ($envResult['patchedUrl']) {
                    $this->store->appendLog('Set APP_URL in packages/api/.env from the update request.');
                }
            }
        }
    }

    private function backupApiEnvFile(string $backupDir): void
    {
        $apiRoot = $this->apiEnv->apiPackageRoot($this->install->installRoot());
        if ($apiRoot === null) {
            return;
        }
        $env = $apiRoot.'/.env';
        if (! is_file($env)) {
            return;
        }
        if (@copy($env, $backupDir.'/packages-api.env')) {
            $this->store->appendLog('Backed up packages/api/.env into the update backup folder.');
        }
    }

    private function copyRecursive(string $source, string $dest, bool $allowCancellation = false): void
    {
        if ($allowCancellation) {
            self::throwIfCancelRequested();
        }
        if (is_dir($source)) {
            if (! is_dir($dest) && ! @mkdir($dest, 0775, true)) {
                $reason = self::lastFilesystemError();
                throw new \RuntimeException(
                    'Could not create destination directory: '.$dest.($reason !== '' ? ' ('.$reason.')' : '')
                );
            }
            $items = scandir($source);
            if (! is_array($items)) {
                throw new \RuntimeException('Could not read directory: '.$source);
            }
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') {
                    continue;
                }
                self::copyRecursive($source.'/'.$item, $dest.'/'.$item, $allowCancellation);
            }

            return;
        }
        $destDir = dirname($dest);
        if (! is_dir($destDir) && ! @mkdir($destDir, 0775, true)) {
            $reason = self::lastFilesystemError();
            throw new \RuntimeException(
                'Could not create destination directory: '.$destDir.($reason !== '' ? ' ('.$reason.')' : '')
            );
        }
        if (! is_writable($destDir)) {
            throw new \RuntimeException('Destination directory is not writable: '.$destDir);
        }
        if (! @copy($source, $dest)) {
            $reason = self::lastFilesystemError();
            throw new \RuntimeException(
                'Could not copy file: '.$source.' -> '.$dest.($reason !== '' ? ' ('.$reason.')' : '')
            );
        }
    }

    private function removeLegacySourceTrees(string $appRoot): void
    {
        foreach (['wgw-src', 'src', 'resources', 'composer.json', 'composer.lock', 'vendor'] as $relative) {
            $path = $appRoot.'/'.$relative;
            if (! file_exists($path)) {
                continue;
            }
            self::rmRecursive($path);
        }
    }

    /**
     * @param  list<string>  $paths
     */
    private function assertApplyCapacity(string $sourceRoot, string $targetRoot, array $paths): void
    {
        $existing = self::collectPathStats($targetRoot, $paths);
        $incoming = self::collectPathStats($sourceRoot, $paths);

        $byteGrowth = max(0, $incoming['bytes'] - $existing['bytes']);
        $inodeGrowth = max(0, $incoming['inodes'] - $existing['inodes']);
        $byteSafetyBuffer = 128 * 1024 * 1024; // Keep headroom for filesystem metadata and runtime overhead.
        $inodeSafetyBuffer = 2048;
        $requiredBytes = $byteGrowth + $byteSafetyBuffer;
        $requiredInodes = $inodeGrowth + $inodeSafetyBuffer;

        $filesystemFreeBytes = self::readFilesystemFreeBytes($targetRoot);
        $quotaFreeBytes = self::detectQuotaFreeBytes();
        $effectiveFreeBytes = self::minKnownInt($filesystemFreeBytes, $quotaFreeBytes);
        if (is_int($effectiveFreeBytes)) {
            if ($effectiveFreeBytes < $requiredBytes) {
                $sources = [];
                if (is_int($filesystemFreeBytes)) {
                    $sources[] = 'filesystem: '.self::formatByteCount($filesystemFreeBytes);
                }
                if (is_int($quotaFreeBytes)) {
                    $sources[] = 'quota: '.self::formatByteCount($quotaFreeBytes);
                }
                throw new \RuntimeException(
                    'Insufficient free disk space to apply update. '.
                    'Need at least '.self::formatByteCount($requiredBytes).' free (including safety margin), '.
                    'but only '.self::formatByteCount($effectiveFreeBytes).' is available'.(count($sources) > 0 ? ' ('.implode(', ', $sources).')' : '').'. '.
                    'Free space by deleting old backups or temporary files under wgw-content/updates and retry.'
                );
            }
        }

        if (function_exists('statvfs')) {
            $vfs = @statvfs($targetRoot);
            $freeInodesRaw = is_array($vfs) && isset($vfs['f_favail']) ? $vfs['f_favail'] : null;
            $freeInodes = is_int($freeInodesRaw) || is_float($freeInodesRaw) ? max(0, (int) $freeInodesRaw) : null;
            if (is_int($freeInodes) && $freeInodes < $requiredInodes) {
                throw new \RuntimeException(
                    'Insufficient free inodes to apply update. '.
                    'Need at least '.number_format($requiredInodes).' free inodes (including safety margin), '.
                    'but only '.number_format($freeInodes).' is available. '.
                    'Free inode usage (many small files) and retry.'
                );
            }
        }
    }

    /**
     * @param  list<string>  $paths
     * @return array{bytes: int, inodes: int}
     */
    private function collectPathStats(string $root, array $paths): array
    {
        $bytes = 0;
        $inodes = 0;
        foreach ($paths as $relative) {
            $full = $root.'/'.$relative;
            if (! file_exists($full) && ! is_link($full)) {
                continue;
            }
            $stats = self::pathStats($full);
            $bytes += $stats['bytes'];
            $inodes += $stats['inodes'];
        }

        return ['bytes' => max(0, $bytes), 'inodes' => max(0, $inodes)];
    }

    /**
     * @return array{bytes: int, inodes: int}
     */
    private function pathStats(string $path): array
    {
        if (is_link($path)) {
            $size = @filesize($path);

            return [
                'bytes' => max(0, (int) ($size === false ? 0 : $size)),
                'inodes' => 1,
            ];
        }
        if (is_file($path)) {
            $size = @filesize($path);

            return [
                'bytes' => max(0, (int) ($size === false ? 0 : $size)),
                'inodes' => 1,
            ];
        }
        if (! is_dir($path)) {
            return ['bytes' => 0, 'inodes' => 0];
        }
        $items = scandir($path);
        if (! is_array($items)) {
            return ['bytes' => 0, 'inodes' => 1];
        }
        $bytes = 0;
        $inodes = 1; // Count the directory itself.
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $child = $path.'/'.$item;
            $childStats = self::pathStats($child);
            $bytes += $childStats['bytes'];
            $inodes += $childStats['inodes'];
        }

        return ['bytes' => max(0, $bytes), 'inodes' => max(0, $inodes)];
    }

    private function formatByteCount(int $bytes): string
    {
        if ($bytes <= 0) {
            return '0 B';
        }
        $units = ['B', 'KB', 'MB', 'GB', 'TB'];
        $value = (float) $bytes;
        $idx = 0;
        while ($value >= 1024 && $idx < count($units) - 1) {
            $value /= 1024;
            $idx++;
        }
        $precision = $value >= 100 || $idx === 0 ? 0 : 1;

        return number_format($value, $precision).' '.$units[$idx];
    }

    /**
     * @return list<array{ok: bool, label: string, detail: string, status?: string}>
     */
    private function capacityChecks(string $path): array
    {
        $freeBytes = self::readFilesystemFreeBytes($path);
        $quotaFreeBytes = self::detectQuotaFreeBytes();

        $freeInodes = null;
        if (function_exists('statvfs')) {
            $vfs = @statvfs($path);
            $freeInodesRaw = is_array($vfs) && isset($vfs['f_favail']) ? $vfs['f_favail'] : null;
            if (is_int($freeInodesRaw) || is_float($freeInodesRaw)) {
                $freeInodes = max(0, (int) $freeInodesRaw);
            }
        }

        $diskKnown = is_int($freeBytes);
        $diskOk = ! $diskKnown || $freeBytes >= 512 * 1024 * 1024;
        $diskDetail = is_int($freeBytes)
            ? (self::formatByteCount($freeBytes).($diskOk ? '' : ' (low free disk)'))
            : 'Unknown (not detectable on this host)';

        $inodeKnown = is_int($freeInodes);
        $inodeOk = ! $inodeKnown || $freeInodes >= 10000;
        $inodeDetail = is_int($freeInodes)
            ? (number_format($freeInodes).($inodeOk ? '' : ' (low free inodes)'))
            : 'Unknown (not detectable on this host)';

        return [
            [
                'ok' => $diskOk,
                'label' => 'Free disk space',
                'detail' => $diskDetail,
                'status' => $diskKnown ? ($diskOk ? 'ok' : 'fail') : 'unknown',
            ],
            [
                'ok' => ! is_int($quotaFreeBytes) || $quotaFreeBytes >= 512 * 1024 * 1024,
                'label' => 'Hosting quota free space',
                'detail' => is_int($quotaFreeBytes)
                    ? self::formatByteCount($quotaFreeBytes).($quotaFreeBytes >= 512 * 1024 * 1024 ? '' : ' (low quota free space)')
                    : 'Unknown (quota command unavailable on this host)',
                'status' => is_int($quotaFreeBytes)
                    ? ($quotaFreeBytes >= 512 * 1024 * 1024 ? 'ok' : 'fail')
                    : 'unknown',
            ],
            [
                'ok' => $inodeOk,
                'label' => 'Free inodes',
                'detail' => $inodeDetail,
                'status' => $inodeKnown ? ($inodeOk ? 'ok' : 'fail') : 'unknown',
            ],
        ];
    }

    private function readFilesystemFreeBytes(string $path): ?int
    {
        $freeBytesRaw = @disk_free_space($path);
        if (! is_float($freeBytesRaw)) {
            return null;
        }

        return max(0, (int) $freeBytesRaw);
    }

    private function minKnownInt(?int $a, ?int $b): ?int
    {
        if (is_int($a) && is_int($b)) {
            return min($a, $b);
        }
        if (is_int($a)) {
            return $a;
        }
        if (is_int($b)) {
            return $b;
        }

        return null;
    }

    private function detectQuotaFreeBytes(): ?int
    {
        if (! function_exists('shell_exec')) {
            return null;
        }
        $output = @shell_exec('quota -s 2>/dev/null');
        if (! is_string($output) || trim($output) === '') {
            return null;
        }
        $lines = preg_split('/\R/', $output) ?: [];
        foreach ($lines as $line) {
            $trimmed = trim((string) $line);
            if ($trimmed === '' || $trimmed[0] !== '/') {
                continue;
            }
            $parts = preg_split('/\s+/', $trimmed) ?: [];
            if (count($parts) < 4) {
                continue;
            }
            $used = self::parseQuotaSizeToken($parts[1]);
            $quota = self::parseQuotaSizeToken($parts[2]);
            $limit = self::parseQuotaSizeToken($parts[3]);
            if (! is_int($used)) {
                continue;
            }
            $cap = max((int) ($limit ?? 0), (int) ($quota ?? 0));
            if ($cap <= 0) {
                continue;
            }

            return max(0, $cap - $used);
        }

        return null;
    }

    private function parseQuotaSizeToken(string $token): ?int
    {
        $clean = rtrim(trim($token), '*');
        if ($clean === '' || $clean === '-' || strcasecmp($clean, 'none') === 0) {
            return null;
        }
        if (preg_match('/^([0-9]+(?:\.[0-9]+)?)([KMGTP]?)(?:i?B)?$/i', $clean, $m) !== 1) {
            if (preg_match('/^[0-9]+$/', $clean) === 1) {
                return (int) $clean * 1024;
            }

            return null;
        }
        $value = (float) $m[1];
        $unit = strtoupper($m[2]);
        $power = match ($unit) {
            'K' => 1,
            'M' => 2,
            'G' => 3,
            'T' => 4,
            'P' => 5,
            default => 0,
        };
        $bytes = (int) round($value * (1024 ** $power));

        return max(0, $bytes);
    }

    private function lastFilesystemError(): string
    {
        $last = error_get_last();
        $message = is_array($last)
            ? trim($last['message'])
            : '';

        return $message;
    }

    private function rmRecursive(string $path): void
    {
        if (is_file($path) || is_link($path)) {
            @unlink($path);

            return;
        }
        if (! is_dir($path)) {
            return;
        }
        $items = scandir($path);
        if (! is_array($items)) {
            return;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            self::rmRecursive($path.'/'.$item);
        }
        @rmdir($path);
    }

    /**
     * @param  array<string, mixed>|null  $latest
     */
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
        $scheme = is_array($parts) && isset($parts['scheme'])
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
    private function listBackups(): array
    {
        $dir = $this->store->absolutePath($this->store->backupDir());
        if (! is_dir($dir)) {
            return [];
        }
        $items = scandir($dir);
        if (! is_array($items)) {
            return [];
        }
        $rows = [];
        foreach ($items as $item) {
            if ($item === '.' || $item === '..' || str_starts_with($item, '.')) {
                continue;
            }
            $path = $dir.'/'.$item;
            $isZip = is_file($path) && str_ends_with($item, '.zip');
            $isLegacyDir = is_dir($path) && str_starts_with($item, 'backup-');
            if (! $isZip && ! $isLegacyDir) {
                continue;
            }
            $meta = $isZip ? self::readBackupMetadata($path) : self::readMetadataFromName($item);
            $mtime = @filemtime($path);
            $rows[] = [
                'name' => $item,
                'sizeBytes' => $isZip
                    ? max(0, (int) (@filesize($path) ?: 0))
                    : self::directorySizeBytes($path),
                'modifiedAt' => is_int($mtime) ? date('c', $mtime) : null,
                'fromVersion' => isset($meta['from_version']) && is_string($meta['from_version']) ? $meta['from_version'] : null,
                'toVersion' => isset($meta['to_version']) && is_string($meta['to_version']) ? $meta['to_version'] : null,
                'format' => $isZip ? 'zip' : 'legacy_dir',
                'downloadable' => $isZip,
            ];
        }
        usort(
            $rows,
            static fn (array $a, array $b): int => strcmp((string) ($b['modifiedAt'] ?? ''), (string) ($a['modifiedAt'] ?? ''))
        );

        return $rows;
    }

    /**
     * @return array<string, string>
     */
    private function readMetadataFromName(string $name): array
    {
        if (preg_match('/-from-([A-Za-z0-9._-]+)-to-([A-Za-z0-9._-]+)(?:\.zip)?$/', $name, $m) !== 1) {
            return [];
        }

        return [
            'from_version' => $m[1],
            'to_version' => $m[2],
        ];
    }

    private function directorySizeBytes(string $path): int
    {
        if (! is_dir($path)) {
            return 0;
        }
        $size = 0;
        $items = scandir($path);
        if (! is_array($items)) {
            return 0;
        }
        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }
            $full = $path.'/'.$item;
            if (is_dir($full)) {
                $size += self::directorySizeBytes($full);

                continue;
            }
            $size += max(0, (int) (@filesize($full) ?: 0));
        }

        return $size;
    }

    private function buildBackupBaseName(string $fromVersion, string $toVersion): string
    {
        $from = preg_replace('/[^A-Za-z0-9.]+/', '_', trim($fromVersion)) ?: 'unknown';
        $to = preg_replace('/[^A-Za-z0-9.]+/', '_', trim($toVersion)) ?: 'unknown';

        return 'backup-'.date('YmdHis').'-from-'.$from.'-to-'.$to;
    }

    private function finalizeBackupArchive(
        string $backupDir,
        string $archivePath,
        string $fromVersion,
        string $toVersion
    ): void {
        @mkdir(dirname($archivePath), 0775, true);
        self::createZipFromDirectory(
            $backupDir,
            $archivePath,
            [
                'from_version' => $fromVersion,
                'to_version' => $toVersion,
                'created_at' => date('c'),
            ]
        );
        self::rmRecursive($backupDir);
    }

    /**
     * @param  array<string, mixed>  $metadata
     */
    private function createZipFromDirectory(string $sourceDir, string $archivePath, array $metadata): void
    {
        $zip = new \ZipArchive;
        if ($zip->open($archivePath, \ZipArchive::CREATE | \ZipArchive::OVERWRITE) !== true) {
            throw new \RuntimeException('Could not create backup ZIP archive.');
        }
        self::addPathToZip($zip, $sourceDir, '');
        $zip->addFromString(
            '.backup-meta.json',
            (string) json_encode($metadata, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT)."\n"
        );
        $zip->close();
    }

    private function addPathToZip(\ZipArchive $zip, string $sourcePath, string $relativePath): void
    {
        if (is_dir($sourcePath)) {
            $items = scandir($sourcePath);
            if (! is_array($items)) {
                return;
            }
            foreach ($items as $item) {
                if ($item === '.' || $item === '..') {
                    continue;
                }
                $childSource = $sourcePath.'/'.$item;
                $childRelative = $relativePath === '' ? $item : $relativePath.'/'.$item;
                self::addPathToZip($zip, $childSource, $childRelative);
            }

            return;
        }
        if (! is_file($sourcePath)) {
            return;
        }
        $zip->addFile($sourcePath, $relativePath);
    }

    /**
     * @return array<string, mixed>
     */
    private function readBackupMetadata(string $archivePath): array
    {
        $zip = new \ZipArchive;
        if ($zip->open($archivePath) !== true) {
            return [];
        }
        $raw = $zip->getFromName('.backup-meta.json');
        $zip->close();
        if (! is_string($raw) || trim($raw) === '') {
            return [];
        }
        $decoded = json_decode($raw, true);

        return is_array($decoded) ? $decoded : [];
    }

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

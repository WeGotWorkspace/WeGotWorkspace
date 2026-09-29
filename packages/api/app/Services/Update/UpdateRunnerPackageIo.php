<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Exceptions\ApiHttpException;
use App\Services\Installer\ApiRuntimeEnvService;
use Illuminate\Support\Facades\DB;

trait UpdateRunnerPackageIo
{
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

    /**
     * @param  list<string>  $paths
     */

    private function backupPaths(
        string $sourceRoot,
        string $backupRoot,
        array $paths,
        string $fromVersion,
        string $toVersion
    ): void {
        $total = count($paths);
        $done = 0;
        foreach ($paths as $relative) {
            self::throwIfCancelRequested();
            $src = $sourceRoot.'/'.$relative;
            if (file_exists($src)) {
                $dest = $backupRoot.'/'.$relative;
                self::copyRecursive($src, $dest, true);
            }
            $done++;
            self::writePhaseProgress('backing_up', $fromVersion, $toVersion, $done, $total);
        }
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
                $envResult = $this->apiEnv->ensure($targetRoot, \App\Services\Installer\ApiRuntimeEnvService::guessRequestAppUrl());
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

    /**
     * @param  list<string>  $paths
     */

    private function restorePaths(string $backupRoot, string $targetRoot, array $paths): void
    {
        if (! is_dir($backupRoot)) {
            return;
        }
        foreach ($paths as $relative) {
            $src = $backupRoot.'/'.$relative;
            if (! file_exists($src)) {
                continue;
            }
            $dest = $targetRoot.'/'.$relative;
            self::rmRecursive($dest);
            self::copyRecursive($src, $dest);
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

}

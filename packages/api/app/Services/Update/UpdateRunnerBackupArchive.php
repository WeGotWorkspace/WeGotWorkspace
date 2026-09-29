<?php

declare(strict_types=1);

namespace App\Services\Update;

use App\Exceptions\ApiHttpException;

trait UpdateRunnerBackupArchive
{
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

}

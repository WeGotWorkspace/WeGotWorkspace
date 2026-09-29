<?php

declare(strict_types=1);

namespace App\Services\Update;

final class UpdateRunnerFilesystem
{
    /** @param list<string> $paths */
    public function assertApplyCapacity(string $sourceRoot, string $targetRoot, array $paths): void
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
    public function capacityChecks(string $path): array
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

    public function lastFilesystemError(): string
    {
        $last = error_get_last();
        $message = is_array($last) ? trim($last['message']) : '';

        return $message;
    }

    public function rmRecursive(string $path): void
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
}

<?php

declare(strict_types=1);

namespace App\Services\Jmap\Blobs;

use App\Http\Support\WgwOversizedPost;

/**
 * Limits the blob endpoints advertise and enforce (#1500): the upload limit
 * PHP can see, RFC 9404 maxSizeBlobSet / maxDataSources, and the per-call
 * step budget derived from max_execution_time.
 *
 * Limits PHP cannot see (nginx client_max_body_size, Apache
 * LimitRequestBody, a proxy) are handled by the client adapting its part
 * size (#1519).
 */
final class JmapBlobLimits
{
    /** RFC 9404 §3.1: servers MUST allow at least 64 data sources. */
    public const MIN_DATA_SOURCES = 64;

    /** Bounds per-call bookkeeping (one blob lookup per source). */
    public const MAX_DATA_SOURCES = 1024;

    /**
     * The smaller of WGW_JMAP_MAX_SIZE_UPLOAD and post_max_size (0 or an
     * unparseable value means PHP sets no limit and is ignored).
     * upload_max_filesize is not used: it applies to multipart file uploads,
     * and /jmap/upload takes a raw body.
     */
    public static function maxSizeUpload(?string $postMaxSize = null): int
    {
        $configured = max(0, (int) config('wgw.jmap.max_size_upload', 25_000_000));
        $post = WgwOversizedPost::iniBytes($postMaxSize ?? (string) ini_get('post_max_size'));
        if ($post > 0) {
            return min($configured, $post);
        }

        return $configured;
    }

    /**
     * RFC 9404 maxSizeBlobSet (UnsignedInt|null; null = no limit).
     */
    public static function maxSizeBlobSet(): ?int
    {
        $raw = config('wgw.jmap.max_size_blob_set', 4_000_000_000);
        if ($raw === null || $raw === '' || (is_string($raw) && strtolower(trim($raw)) === 'null')) {
            return null;
        }

        return max(0, (int) $raw);
    }

    /**
     * Seconds one request may run: max_execution_time, or a fixed ceiling
     * when PHP sets none (CLI, some FPM pools).
     */
    public static function timeLimitSeconds(): int
    {
        $limit = (int) ini_get('max_execution_time');
        if ($limit <= 0) {
            $limit = max(1, (int) config('wgw.jmap.step_unlimited_seconds', 60));
        }

        return $limit;
    }

    /**
     * Bytes one call may read or write: a safe share of the time limit at a
     * conservative throughput. Never below 1 MiB.
     */
    public static function stepBudgetBytes(): int
    {
        $share = (float) config('wgw.jmap.step_time_share', 0.5);
        $share = $share > 0 && $share <= 1 ? $share : 0.5;
        $throughput = max(1, (int) config('wgw.jmap.step_throughput_bytes', 8 * 1024 * 1024));

        return max(1024 * 1024, (int) floor(self::timeLimitSeconds() * $share * $throughput));
    }

    /**
     * What one Blob/upload call can process within the step budget, raised
     * to the RFC 9404 floor of 64 (documented deviation: where the budget
     * cannot cover 64 parts, Blob/upload refuses the excess up front) and
     * capped at MAX_DATA_SOURCES. Never derived from the whole file limit.
     */
    public static function maxDataSources(): int
    {
        $perCall = intdiv(self::stepBudgetBytes(), max(1, self::maxSizeUpload()));

        return min(self::MAX_DATA_SOURCES, max(self::MIN_DATA_SOURCES, max(1, $perCall)));
    }

    public static function assemblyTtlSeconds(): int
    {
        return max(1, (int) config('wgw.jmap.assembly_ttl_hours', 24)) * 3600;
    }

    public static function blobTtlHours(): int
    {
        return max(1, (int) config('wgw.jmap.blob_ttl_hours', 24));
    }

    public static function discoveryHashMaxBytes(): int
    {
        return max(0, (int) config('wgw.jmap.discovery_hash_max_bytes', 4 * 1024 * 1024));
    }
}

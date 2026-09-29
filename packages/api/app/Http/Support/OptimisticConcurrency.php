<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Exceptions\ApiHttpException;

final class OptimisticConcurrency
{
    public static function assertPreconditions(
        ?string $ifMatch,
        ?string $ifUnmodifiedSince,
        ?string $storedEtag,
        ?int $lastModified,
        bool $requirePrecondition = true,
    ): void {
        if ($ifMatch === null && $ifUnmodifiedSince === null) {
            if ($requirePrecondition) {
                throw new ApiHttpException(
                    412,
                    'If-Match or If-Unmodified-Since is required.',
                    'precondition_failed',
                );
            }

            return;
        }

        if ($ifMatch !== null) {
            if (! self::ifMatchSatisfied($ifMatch, $storedEtag)) {
                throw new ApiHttpException(
                    412,
                    'Resource etag does not match If-Match.',
                    'precondition_failed',
                );
            }

            return;
        }

        if ($lastModified !== null && $lastModified > 0) {
            $since = self::parseHttpDate($ifUnmodifiedSince);
            if ($since !== null && $lastModified > $since) {
                throw new ApiHttpException(
                    412,
                    'Resource was modified since If-Unmodified-Since.',
                    'precondition_failed',
                );
            }
        }
    }

    public static function formatEtag(?string $rawEtag): ?string
    {
        if ($rawEtag === null || $rawEtag === '') {
            return null;
        }

        if (str_starts_with($rawEtag, '"') || str_starts_with($rawEtag, 'W/')) {
            return $rawEtag;
        }

        return '"'.$rawEtag.'"';
    }

    public static function ifMatchSatisfied(string $ifMatch, ?string $storedEtag): bool
    {
        if (trim($ifMatch) === '*') {
            return $storedEtag !== null && $storedEtag !== '';
        }

        $normalizedStored = self::normalizeEtag(self::formatEtag($storedEtag) ?? '');
        if ($normalizedStored === '') {
            return false;
        }

        foreach (array_map('trim', explode(',', $ifMatch)) as $candidate) {
            if ($candidate === '*') {
                return true;
            }

            if (self::normalizeEtag($candidate) === $normalizedStored) {
                return true;
            }
        }

        return false;
    }

    private static function normalizeEtag(string $etag): string
    {
        $etag = trim($etag);
        if (str_starts_with($etag, 'W/')) {
            $etag = substr($etag, 2);
        }

        return trim($etag, '"');
    }

    private static function parseHttpDate(string $value): ?int
    {
        $timestamp = strtotime($value);

        return $timestamp !== false ? $timestamp : null;
    }
}

<?php

declare(strict_types=1);

namespace App\Http\Support;

use Illuminate\Http\Request;

/**
 * Best-effort oversized-POST detector — not a hard guarantee.
 *
 * PHP empties the body when post_max_size is exceeded and may emit a line-0
 * warning before any script runs. `exceedsLimit()` only sees Content-Length;
 * chunked requests without that header return false here. Callers that see an
 * empty body must also use {@see emptyBodyLooksDiscarded()}.
 *
 * `display_errors=0` in `.user.ini` / `.htaccess` / `docker/php/uploads.ini`
 * is what stops the line-0 warning from leaking HTML. `ini_set` in index.php
 * is too late for that warning (shared hosts often ship display_errors=On).
 */
final class WgwOversizedPost
{
    /**
     * @return array{error: string, code: string}
     */
    public static function payload(?string $postMaxSize = null): array
    {
        $max = trim($postMaxSize ?? (string) ini_get('post_max_size'));
        $hint = $max !== ''
            ? "Current server post_max_size is {$max}."
            : 'Current server post_max_size is too low.';

        return [
            'error' => "Upload too large. {$hint}",
            'code' => 'post_too_large',
        ];
    }

    public static function iniBytes(string $value): int
    {
        $trimmed = strtolower(trim($value));
        if ($trimmed === '' || $trimmed === '0') {
            return 0;
        }

        $unit = substr($trimmed, -1);
        $number = $trimmed;
        $factor = 1;
        if (! is_numeric($unit)) {
            $number = substr($trimmed, 0, -1);
            $factor = match ($unit) {
                'g' => 1024 ** 3,
                'm' => 1024 ** 2,
                'k' => 1024,
                default => 1,
            };
        }

        return (int) round((float) $number * $factor);
    }

    /**
     * Declared Content-Length, or null when the header is missing / not numeric
     * (chunked transfer, HTTP/2 without a length).
     */
    public static function declaredContentLength(?Request $request = null): ?int
    {
        $raw = self::rawContentLength($request);
        if ($raw === null || $raw === '' || ! is_numeric($raw)) {
            return null;
        }

        return (int) $raw;
    }

    public static function contentLength(?Request $request = null): int
    {
        return self::declaredContentLength($request) ?? 0;
    }

    /**
     * True only when a declared Content-Length is greater than post_max_size.
     * Missing / non-numeric length is unknown — returns false.
     */
    public static function exceedsLimit(?Request $request = null, ?int $contentLength = null): bool
    {
        $max = self::iniBytes((string) ini_get('post_max_size'));
        if ($max <= 0) {
            return false;
        }

        $length = $contentLength ?? self::declaredContentLength($request);
        if ($length === null) {
            return false;
        }

        return $length > $max;
    }

    public static function isChunkedTransfer(?Request $request = null): bool
    {
        $raw = $request instanceof Request
            ? (string) ($request->headers->get('Transfer-Encoding') ?? $request->server->get('HTTP_TRANSFER_ENCODING', ''))
            : (string) ($_SERVER['HTTP_TRANSFER_ENCODING'] ?? '');

        return str_contains(strtolower($raw), 'chunked');
    }

    public static function phpWarnedPostTooLarge(): bool
    {
        $last = error_get_last();
        if (! is_array($last)) {
            return false;
        }
        $message = (string) ($last['message'] ?? '');

        return str_contains($message, 'post_max_size')
            || (str_contains($message, 'POST Content-Length') && str_contains($message, 'exceeds'));
    }

    /**
     * Empty parsed body after PHP may have discarded an oversized POST:
     * declared Content-Length oversize, a PHP warning, or chunked transfer
     * (no trustworthy length).
     */
    public static function emptyBodyLooksDiscarded(?Request $request = null): bool
    {
        if (self::exceedsLimit($request)) {
            return true;
        }
        if (self::phpWarnedPostTooLarge()) {
            return true;
        }

        return self::isChunkedTransfer($request);
    }

    /**
     * Front controller only (`public/index.php` after autoload, before
     * Laravel). Safe to `exit` here because the kernel has not started.
     * Content-Length only — chunked oversize is handled later in Laravel.
     */
    public static function abortIfExceeded(): void
    {
        if (! self::exceedsLimit()) {
            return;
        }

        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        http_response_code(413);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(self::payload(), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        exit;
    }

    private static function rawContentLength(?Request $request): mixed
    {
        if ($request instanceof Request) {
            $fromServer = $request->server->get('CONTENT_LENGTH');
            if ($fromServer !== null && $fromServer !== '') {
                return $fromServer;
            }

            return $request->headers->get('Content-Length');
        }

        if (array_key_exists('CONTENT_LENGTH', $_SERVER)) {
            return $_SERVER['CONTENT_LENGTH'];
        }
        if (array_key_exists('HTTP_CONTENT_LENGTH', $_SERVER)) {
            return $_SERVER['HTTP_CONTENT_LENGTH'];
        }

        return null;
    }
}

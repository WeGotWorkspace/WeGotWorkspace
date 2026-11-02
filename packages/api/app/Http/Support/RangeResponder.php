<?php

declare(strict_types=1);

namespace App\Http\Support;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Streams an opened read stream as an HTTP response with single-range
 * support (#1500), shared by `/jmap/download`, download tickets, and
 * `GET /files/content`:
 *
 *  - `Accept-Ranges: bytes` on every answer
 *  - one `Range: bytes=a-b | a- | -n` → 206 with `Content-Range`
 *  - an unsatisfiable range → 416 with `Content-Range: bytes * /size`
 *  - several ranges, a non-bytes unit, or a malformed value → the full 200
 *    (RFC 9110 §14.2 lets a server ignore a Range it does not support)
 *  - `If-Range` (RFC 9110 §13.1.5) against the caller's `ETag` or
 *    `Last-Modified`: no match → the full 200, so a resume never glues
 *    bytes of two versions; without a validator the Range is ignored too
 *  - `If-None-Match` matching the caller's `ETag` → 304 without a body
 *  - `X-Accel-Buffering: no`, so a buffering proxy passes chunks on as they
 *    are written (a ticket counts as active only while chunks are written)
 *
 * Callers send a strong `ETag` only when the bytes can never change under it.
 *
 * `Content-Length` and the range arithmetic use the opened stream's size at
 * stream time, never a stored size that can be stale. Memory use does not
 * grow with the file: the body is copied in fixed chunks. HEAD gets the
 * headers without a body (Symfony drops the callback for HEAD).
 */
class RangeResponder
{
    public const DEFAULT_CHUNK = 1024 * 1024;

    public function __construct(private readonly int $chunkSize = self::DEFAULT_CHUNK) {}

    /**
     * @param  resource  $stream  readable, opened by the caller; closed here
     * @param  array<string, string>  $headers  Content-Type, Content-Disposition, …
     * @param  (callable(bool): void)|null  $onActivity  called after every chunk with
     *                                                   false, and once with true when the body is done
     */
    public function respond(Request $request, $stream, array $headers, ?callable $onActivity = null): Response
    {
        $size = $this->streamSize($stream);
        $headers['Accept-Ranges'] = 'bytes';
        $headers['X-Accel-Buffering'] = 'no';
        $etag = $headers['ETag'] ?? null;

        if ($etag !== null && $request->isMethodCacheable() && $this->noneMatchHits($request->headers->get('If-None-Match'), $etag)) {
            fclose($stream);

            return new Response('', 304, array_intersect_key($headers, array_flip(['ETag', 'Last-Modified', 'Cache-Control', 'X-Accel-Buffering'])));
        }

        $rangeHeader = $request->headers->get('Range');
        $ifRange = $request->headers->get('If-Range');
        if ($rangeHeader !== null && $ifRange !== null && ! $this->ifRangeMatches($ifRange, $etag, $headers['Last-Modified'] ?? null)) {
            $rangeHeader = null;
        }

        $range = $this->parseRange($rangeHeader, $size);
        if ($range === false) {
            fclose($stream);

            return new Response('', 416, $headers + ['Content-Range' => 'bytes */'.$size]);
        }

        $status = 200;
        [$start, $end] = $range ?? [0, $size - 1];
        $length = $size === 0 ? 0 : $end - $start + 1;
        if ($range !== null) {
            $status = 206;
            $headers['Content-Range'] = 'bytes '.$start.'-'.$end.'/'.$size;
        }
        $headers['Content-Length'] = (string) $length;

        $chunkSize = max(1, $this->chunkSize);

        return new StreamedResponse(function () use ($stream, $start, $length, $chunkSize, $onActivity): void {
            try {
                $this->seek($stream, $start);
                $remaining = $length;
                while ($remaining > 0 && ! feof($stream)) {
                    $chunk = fread($stream, min($chunkSize, $remaining));
                    if ($chunk === false || $chunk === '') {
                        break;
                    }
                    echo $chunk;
                    $remaining -= strlen($chunk);
                    if (ob_get_level() === 0) {
                        flush();
                    }
                    if ($onActivity !== null) {
                        $onActivity(false);
                    }
                }
            } finally {
                if (is_resource($stream)) {
                    fclose($stream);
                }
                if ($onActivity !== null) {
                    $onActivity(true);
                }
            }
        }, $status, $headers);
    }

    /**
     * Validators for a file served straight from disk, from the opened
     * stream itself so they describe exactly the bytes being sent: a strong
     * ETag from inode, size, and mtime, plus Last-Modified. Both are left
     * out while the mtime is in the current second: a second write in that
     * same second could keep size and mtime (RFC 9110 §8.8.2.2).
     *
     * @param  resource  $stream
     * @return array<string, string>
     */
    public static function fileValidators($stream): array
    {
        $stat = fstat($stream);
        if (! is_array($stat) || (int) $stat['mtime'] <= 0 || (int) $stat['mtime'] >= time()) {
            return [];
        }
        $mtime = (int) $stat['mtime'];

        return [
            'ETag' => '"'.substr(hash('sha256', $stat['dev'].':'.$stat['ino'].':'.$stat['size'].':'.$mtime), 0, 32).'"',
            'Last-Modified' => gmdate('D, d M Y H:i:s', $mtime).' GMT',
        ];
    }

    /**
     * RFC 9110 §13.1.5: a strong entity-tag compared strongly with the
     * current ETag, or an HTTP-date equal to the current Last-Modified.
     */
    public function ifRangeMatches(string $ifRange, ?string $etag, ?string $lastModified): bool
    {
        $ifRange = trim($ifRange);
        if (str_starts_with($ifRange, '"')) {
            return $etag !== null && ! str_starts_with($etag, 'W/') && $ifRange === $etag;
        }
        if (str_starts_with($ifRange, 'W/') || $lastModified === null) {
            return false;
        }
        $requested = strtotime($ifRange);
        $current = strtotime($lastModified);

        return $requested !== false && $current !== false && $requested === $current;
    }

    /**
     * RFC 9110 §13.1.2: `*` or any listed tag that weakly matches.
     */
    private function noneMatchHits(?string $ifNoneMatch, string $etag): bool
    {
        if ($ifNoneMatch === null) {
            return false;
        }
        if (trim($ifNoneMatch) === '*') {
            return true;
        }
        $opaque = static fn (string $tag): string => str_starts_with($tag, 'W/') ? substr($tag, 2) : $tag;
        foreach (explode(',', $ifNoneMatch) as $candidate) {
            if ($opaque(trim($candidate)) === $opaque($etag)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @return array{0: int, 1: int}|false|null null = serve the whole body,
     *                                          false = unsatisfiable (416)
     */
    public function parseRange(?string $header, int $size): array|false|null
    {
        if ($header === null) {
            return null;
        }
        $header = trim($header);
        if (! str_starts_with(strtolower($header), 'bytes=')) {
            return null;
        }
        $spec = trim(substr($header, 6));
        if ($spec === '' || str_contains($spec, ',')) {
            return null;
        }
        if (preg_match('/^(\d*)-(\d*)$/', $spec, $m) !== 1 || ($m[1] === '' && $m[2] === '')) {
            return null;
        }

        if ($m[1] === '') {
            // Suffix range: the last n bytes.
            $suffix = (int) $m[2];
            if ($suffix === 0 || $size === 0) {
                return false;
            }

            return [max(0, $size - $suffix), $size - 1];
        }

        $start = (int) $m[1];
        if ($m[2] !== '' && (int) $m[2] < $start) {
            return null;
        }
        if ($start >= $size) {
            return false;
        }
        $end = $m[2] === '' ? $size - 1 : min((int) $m[2], $size - 1);

        return [$start, $end];
    }

    /**
     * @param  resource  $stream
     */
    private function streamSize($stream): int
    {
        $stat = fstat($stream);

        return is_array($stat) ? max(0, (int) $stat['size']) : 0;
    }

    /**
     * @param  resource  $stream
     */
    private function seek($stream, int $offset): void
    {
        if ($offset <= 0) {
            return;
        }
        $meta = stream_get_meta_data($stream);
        if ($meta['seekable'] && fseek($stream, $offset) === 0) {
            return;
        }
        // Non-seekable source: read and drop the leading bytes.
        $skip = $offset;
        while ($skip > 0 && ! feof($stream)) {
            $chunk = fread($stream, min(self::DEFAULT_CHUNK, $skip));
            if ($chunk === false || $chunk === '') {
                break;
            }
            $skip -= strlen($chunk);
        }
    }
}

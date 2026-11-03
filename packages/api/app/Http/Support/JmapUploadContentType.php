<?php

declare(strict_types=1);

namespace App\Http\Support;

/**
 * Keeps a JSON-typed `/jmap/upload` body out of memory (#1500).
 *
 * `Illuminate\Http\Request::createFromBase()` decodes the whole body when the
 * Content-Type contains `/json` or `+json`, which would make `memory_limit`
 * bound a part. Before the request is captured, `index.php` hides that type
 * behind `application/octet-stream` and parks the real one in a server
 * variable the client cannot set (no `HTTP_` prefix).
 */
final class JmapUploadContentType
{
    public const SERVER_KEY = 'WGW_UPLOAD_CONTENT_TYPE';

    /**
     * @param  array<string, mixed>  $server
     * @return array<string, mixed>
     */
    public static function mask(array $server): array
    {
        $uri = (string) ($server['REQUEST_URI'] ?? '');
        $path = (string) parse_url($uri, PHP_URL_PATH);
        if (($server['REQUEST_METHOD'] ?? '') !== 'POST' || preg_match('#/jmap/upload/[^/]+/?$#', $path) !== 1) {
            return $server;
        }
        $type = (string) ($server['CONTENT_TYPE'] ?? $server['HTTP_CONTENT_TYPE'] ?? '');
        if (! str_contains($type, '/json') && ! str_contains($type, '+json')) {
            return $server;
        }
        $server[self::SERVER_KEY] = $type;
        $server['CONTENT_TYPE'] = 'application/octet-stream';
        unset($server['HTTP_CONTENT_TYPE']);

        return $server;
    }
}

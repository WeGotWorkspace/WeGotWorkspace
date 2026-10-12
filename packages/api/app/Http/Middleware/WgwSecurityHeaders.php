<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\AppPaths;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class WgwSecurityHeaders
{
    public const FALLBACK_SCRIPT_HASH = 'sha256-koYKTa6HwF82TTLzdGOJpStHMXx2oeIvhoodNHKGkOg=';

    private const HSTS = 'max-age=15552000';

    /** @var array{fingerprint: string, hashes: list<string>}|null */
    private static ?array $scriptHashCache = null;

    public function __construct(private AppPaths $paths) {}

    /**
     * @param  Closure(Request): Response  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->remove('X-Powered-By');
        $response->headers->set('X-Content-Type-Options', 'nosniff');
        $response->headers->set('X-Frame-Options', 'SAMEORIGIN');
        $response->headers->set('Referrer-Policy', 'strict-origin-when-cross-origin');
        $response->headers->set(
            'Content-Security-Policy-Report-Only',
            $this->contentSecurityPolicy(),
        );
        if ($request->isSecure()) {
            $response->headers->set('Strict-Transport-Security', self::HSTS);
        }

        return $response;
    }

    private function contentSecurityPolicy(): string
    {
        $scriptSrc = "script-src 'self'";
        $hashes = $this->scriptHashes();
        if ($hashes !== []) {
            $quoted = array_map(
                static fn (string $hash): string => "'".$hash."'",
                $hashes,
            );
            $scriptSrc .= ' '.implode(' ', $quoted);
        }

        return implode('; ', [
            "default-src 'self'",
            $scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' blob: data:",
            "font-src 'self'",
            "connect-src 'self'",
            "media-src 'self' blob:",
            "worker-src 'self'",
            "manifest-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'self'",
            'report-uri /api/v1/csp-reports',
        ]);
    }

    /**
     * @return list<string>
     */
    private function scriptHashes(): array
    {
        $path = $this->cspHashFilePath();
        $fingerprint = 'missing';
        if ($path !== null) {
            clearstatcache(true, $path);
            $mtime = filemtime($path);
            $size = filesize($path);
            $fingerprint = $path
                .'|'.($mtime === false ? '0' : (string) $mtime)
                .'|'.($size === false ? '0' : (string) $size);
        }
        if (
            self::$scriptHashCache !== null
            && self::$scriptHashCache['fingerprint'] === $fingerprint
        ) {
            return self::$scriptHashCache['hashes'];
        }

        $hashes = $path === null
            ? [self::FALLBACK_SCRIPT_HASH]
            : $this->hashesFromFile($path);
        self::$scriptHashCache = [
            'fingerprint' => $fingerprint,
            'hashes' => $hashes,
        ];

        return $hashes;
    }

    private function cspHashFilePath(): ?string
    {
        $root = $this->paths->shellDistRoot();
        if ($root === null) {
            return null;
        }
        $path = rtrim($root, '/').'/csp-hashes.json';

        return is_file($path) ? $path : null;
    }

    /**
     * @return list<string>
     */
    private function hashesFromFile(string $path): array
    {
        $raw = file_get_contents($path, false, null, 0, 4096);
        if (! is_string($raw) || $raw === '') {
            return [self::FALLBACK_SCRIPT_HASH];
        }

        $decoded = json_decode($raw, true);
        if (
            ! is_array($decoded)
            || ! array_key_exists('hashes', $decoded)
            || ! is_array($decoded['hashes'])
        ) {
            return [self::FALLBACK_SCRIPT_HASH];
        }
        if ($decoded['hashes'] === []) {
            return [];
        }

        $hashes = [];
        foreach ($decoded['hashes'] as $hash) {
            if (! is_string($hash) || preg_match('#^sha256-[A-Za-z0-9+/]{43}=$#', $hash) !== 1) {
                return [self::FALLBACK_SCRIPT_HASH];
            }
            $hashes[] = $hash;
        }

        return $hashes;
    }
}

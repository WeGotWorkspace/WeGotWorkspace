<?php

declare(strict_types=1);

namespace App\Ui;

use App\Services\Installer\InstallerWebBase;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves built SPA assets from a module dist directory (shell, drive, install, …).
 */
final class UiStaticServer
{
    /** @var list<string> */
    private const GLOBAL_PREFIXES = [
        '/app-icons',
        '/assets',
        '/fonts',
        '/pwa-icons',
        '/manifests',
    ];

    public function distReady(string $distRoot): bool
    {
        return is_file(rtrim($distRoot, '/').'/index.html');
    }

    public function matchesShellPath(string $webBase, string $path): bool
    {
        if ($this->isPwaRootAssetPath($webBase, $path)) {
            return true;
        }

        foreach (self::GLOBAL_PREFIXES as $prefix) {
            $full = InstallerWebBase::url($webBase, $prefix);
            if ($path === $full || str_starts_with($path, $full.'/')) {
                return true;
            }
        }

        return $this->resolveRoutePrefix($webBase, $path, self::shellRoutePrefixes()) !== null;
    }

    public function matchesInstallPath(string $webBase, string $path): bool
    {
        $prefix = InstallerWebBase::url($webBase, '/install');

        return $path === $prefix || $path === $prefix.'/' || str_starts_with($path, $prefix.'/');
    }

    public function tryServe(string $distRoot, string $webBase, string $path, bool $spaFallback): ?Response
    {
        $root = rtrim($distRoot, '/');
        if (! $this->distReady($root)) {
            return null;
        }

        if ($this->isPwaRootAssetPath($webBase, $path)) {
            return $this->serveResolvedPath($root, $this->pwaRootAssetRelativePath($webBase, $path), false);
        }

        foreach (self::GLOBAL_PREFIXES as $prefix) {
            $full = InstallerWebBase::url($webBase, $prefix);
            if ($path !== $full && ! str_starts_with($path, $full.'/')) {
                continue;
            }
            $suffix = $path === $full ? '' : substr($path, strlen($full) + 1);
            $suffix = is_string($suffix) ? $suffix : '';
            $rel = ltrim($prefix, '/').($suffix !== '' ? '/'.str_replace('\\', '/', rawurldecode($suffix)) : '');

            return $this->serveResolvedPath($root, $rel, false);
        }

        $routePrefix = $this->resolveRoutePrefix($webBase, $path, self::spaRoutePrefixes());
        if ($routePrefix === null) {
            return null;
        }

        $rel = $this->relativePath($path, $routePrefix);

        return $this->serveResolvedPath($root, $rel, $spaFallback);
    }

    /**
     * Top-level SPA prefixes served by the shell (and install) dist — keep in sync with
     * `packages/apps/.../wegotworkspace-routes.tsx`. Architecture test
     * SpaShellRouteAllowlistTest fails when a router top-level path is missing here.
     *
     * When adding a new top-level app route (e.g. `/share`, `/tasks`): update this list,
     * FrontRoutingTest, and the apps router together.
     *
     * @return list<string>
     */
    public static function spaRoutePrefixes(): array
    {
        return [
            ...self::shellRoutePrefixes(),
            '/install',
        ];
    }

    /**
     * @param  list<string>  $prefixes
     */
    public function resolveRoutePrefix(string $webBase, string $path, array $prefixes): ?string
    {
        $best = null;
        $bestLength = -1;

        foreach ($prefixes as $prefix) {
            $full = InstallerWebBase::url($webBase, $prefix);
            if (! $this->pathMatchesRoutePrefix($path, $full, $prefix)) {
                continue;
            }
            $length = strlen($full);
            if ($length > $bestLength) {
                $best = $full;
                $bestLength = $length;
            }
        }

        return $best;
    }

    /**
     * Shell module prefixes (excludes /install, which has its own dist + matcher).
     *
     * @return list<string>
     */
    public static function shellRoutePrefixes(): array
    {
        return [
            '/',
            '/admin',
            '/calendar',
            '/contacts',
            '/docs',
            '/drive',
            '/login',
            '/logout',
            '/mail',
            '/meet',
            '/notes',
            '/settings',
            '/share',
            '/tasks',
        ];
    }

    private function pathMatchesRoutePrefix(string $path, string $full, string $prefix): bool
    {
        if ($prefix === '/') {
            return $path === '/' || $path === '';
        }

        return $path === $full || $path === $full.'/' || str_starts_with($path, $full.'/');
    }

    private function relativePath(string $path, string $prefix): string
    {
        if ($path === $prefix || $path === $prefix.'/') {
            return '';
        }
        $relative = substr($path, strlen($prefix) + 1);

        return is_string($relative) ? str_replace('\\', '/', rawurldecode($relative)) : '';
    }

    private function serveResolvedPath(string $root, string $rel, bool $allowSpaFallback): ?Response
    {
        if ($rel !== '' && (str_contains($rel, "\0") || str_contains($rel, '..'))) {
            return $this->notFound();
        }

        $fs = $this->mapUrlToFilesystem($root, $rel);
        if ($fs === null) {
            if ($rel !== '' && preg_match('#^(css|js|img|fonts|assets|app-icons|pwa-icons|manifests)/#', $rel) === 1) {
                return null;
            }
            if (! $allowSpaFallback) {
                return $this->notFound();
            }
            $index = $root.'/index.html';
            $looksLikeAsset = $rel !== '' && preg_match('/\.[A-Za-z0-9]{1,8}$/', $rel) === 1;
            if (is_file($index) && ! str_starts_with($rel, 'assets/') && ! $looksLikeAsset) {
                $fs = $index;
            } else {
                return null;
            }
        }

        $realRoot = realpath($root);
        $realFile = is_readable($fs) ? realpath($fs) : false;
        if ($realRoot === false || $realFile === false || ! str_starts_with($realFile, $realRoot)) {
            return $this->notFound();
        }

        $ext = strtolower(pathinfo($realFile, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'js', 'mjs' => 'application/javascript; charset=utf-8',
            'css' => 'text/css; charset=utf-8',
            'html', 'htm' => 'text/html; charset=utf-8',
            'json', 'map' => 'application/json; charset=utf-8',
            'svg' => 'image/svg+xml',
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'ico' => 'image/x-icon',
            'gif' => 'image/gif',
            'woff' => 'font/woff',
            'woff2' => 'font/woff2',
            'ttf' => 'font/ttf',
            'otf' => 'font/otf',
            'txt' => 'text/plain; charset=utf-8',
            'xml' => 'application/xml; charset=utf-8',
            'webmanifest' => 'application/manifest+json; charset=utf-8',
            default => 'application/octet-stream',
        };

        $cacheControl = ($ext === 'html' || $ext === 'htm')
            ? 'no-store, no-cache, must-revalidate'
            : 'public, max-age=86400';

        return new BinaryFileResponse($realFile, 200, [
            'Content-Type' => $mime,
            'Cache-Control' => $cacheControl,
        ]);
    }

    private function mapUrlToFilesystem(string $root, string $rel): ?string
    {
        $rel = ltrim($rel, '/');
        if ($rel === '') {
            return null;
        }
        $direct = $root.'/'.$rel;

        return is_file($direct) ? $direct : null;
    }

    private function isPwaRootAssetPath(string $webBase, string $path): bool
    {
        $rel = $this->pwaRootAssetRelativePath($webBase, $path);
        if ($rel === '' || str_contains($rel, '/')) {
            return false;
        }

        if (! $this->isPwaRootAssetFile($rel)) {
            return false;
        }

        return $path === InstallerWebBase::url($webBase, '/'.$rel);
    }

    private function pwaRootAssetRelativePath(string $webBase, string $path): string
    {
        $prefix = InstallerWebBase::url($webBase, '/');
        $suffix = $prefix === '/' ? ltrim($path, '/') : substr($path, strlen($prefix));

        return is_string($suffix) ? ltrim($suffix, '/') : '';
    }

    private function isPwaRootAssetFile(string $basename): bool
    {
        return $basename === 'index.html'
            || $basename === 'sw.js'
            || (str_starts_with($basename, 'workbox-') && str_ends_with($basename, '.js'));
    }

    private function notFound(): Response
    {
        return new Response('Not found', 404, ['Content-Type' => 'text/plain; charset=utf-8']);
    }
}

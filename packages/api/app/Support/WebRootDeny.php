<?php

declare(strict_types=1);

namespace App\Support;

/**
 * Deny files for a data directory that lives inside the web root.
 */
final class WebRootDeny
{
    public const string PROBE = "wgw-content-probe\n";

    public const string HTACCESS = <<<'HTACCESS'
<IfModule mod_authz_core.c>
    Require all denied
</IfModule>
<IfModule !mod_authz_core.c>
    Deny from all
</IfModule>

HTACCESS;

    private const LEGACY_LINES = [
        'RedirectMatch 404 ^/(?:wgw-content|wgw-private|wgw-modules|packages)(?:/|$)',
        'RedirectMatch 404 /\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$)',
    ];

    public static function ensure(string $dataDir): void
    {
        $dir = rtrim($dataDir, '/');
        if ($dir === '' || ! is_dir($dir)) {
            return;
        }

        $htaccess = $dir.'/.htaccess';
        if (! is_file($htaccess)) {
            @file_put_contents($htaccess, self::HTACCESS, LOCK_EX);
        }

        $probe = $dir.'/.probe';
        if (! is_file($probe)) {
            @file_put_contents($probe, self::PROBE, LOCK_EX);
        }
    }

    /** Writes .htaccess (deny) and .probe in each existing directory. */
    public static function ensureAll(string $installRoot, string $dataDir): void
    {
        $root = rtrim($installRoot, '/');
        foreach ([$dataDir, $root.'/packages', $root.'/wgw-plugins'] as $dir) {
            self::ensure($dir);
        }
    }

    /**
     * Keep the two root RedirectMatch rules between managed markers.
     * Returns false when the install-root .htaccess is missing or not writable.
     */
    public static function ensureRootRules(string $installRoot): bool
    {
        $path = self::rootHtaccessPath($installRoot);
        if ($path === null) {
            return false;
        }

        clearstatcache(true, $path);
        if (! is_writable($path)) {
            return false;
        }

        $current = file_get_contents($path);
        if (! is_string($current)) {
            return false;
        }

        $updated = self::htaccessWithManagedBlock($current);
        if ($updated === $current) {
            return true;
        }

        return @file_put_contents($path, $updated, LOCK_EX) !== false;
    }

    private static function rootHtaccessPath(string $installRoot): ?string
    {
        $root = rtrim($installRoot, '/');
        if ($root === '') {
            return null;
        }

        $path = $root.'/.htaccess';

        return is_file($path) ? $path : null;
    }

    private static function htaccessWithManagedBlock(string $htaccess): string
    {
        $block = self::managedDenyBlock();
        $pattern = '/# BEGIN wgw-deny\R.*?# END wgw-deny/s';
        if (preg_match($pattern, $htaccess) === 1) {
            $replaced = preg_replace_callback(
                $pattern,
                static fn (): string => $block,
                $htaccess,
                1,
            );

            return is_string($replaced) ? $replaced : $htaccess;
        }

        return self::insertManagedDenyBlock($htaccess, $block);
    }

    private static function insertManagedDenyBlock(string $htaccess, string $block): string
    {
        foreach (self::LEGACY_LINES as $line) {
            $stripped = preg_replace('/^'.preg_quote($line, '/').'\R?/m', '', $htaccess);
            if (is_string($stripped)) {
                $htaccess = $stripped;
            }
        }

        if (preg_match('/^Options\b[^\r\n]*/m', $htaccess, $match, PREG_OFFSET_CAPTURE) === 1) {
            $start = $match[0][1];
            $line = $match[0][0];
            $after = $start + strlen($line);
            $ending = self::lineEndingAt($htaccess, $after);
            if ($ending === '') {
                $ending = "\n";
            } else {
                $after += strlen($ending);
            }

            return substr($htaccess, 0, $start + strlen($line)).$ending.$block.$ending.substr($htaccess, $after);
        }

        $ending = str_contains($htaccess, "\r\n") ? "\r\n" : "\n";
        if ($htaccess === '') {
            return $block.$ending;
        }

        return $block.$ending.$htaccess;
    }

    private static function lineEndingAt(string $htaccess, int $offset): string
    {
        $char = $htaccess[$offset] ?? '';
        if ($char === "\r" && ($htaccess[$offset + 1] ?? '') === "\n") {
            return "\r\n";
        }
        if ($char === "\n" || $char === "\r") {
            return $char;
        }

        return '';
    }

    private static function managedDenyBlock(): string
    {
        return <<<'BLOCK'
# BEGIN wgw-deny
RedirectMatch 404 ^/(?:wgw-content|wgw-plugins|packages)(?:/|$)
RedirectMatch 404 ^/\.(?:git|svn|hg|env|htaccess|htpasswd|user\.ini)(?:[/.]|$)
# END wgw-deny
BLOCK;
    }
}

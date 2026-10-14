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
     * Keep the root deny rules and security headers between managed markers.
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
        $htaccess = self::withManagedBlock($htaccess, 'wgw-deny', self::managedDenyBlock());
        // Installs from before the markers keep an unmarked mod_headers block that
        // still sends Content-Security-Policy-Report-Only. Swap that block for the
        // managed one, or the old header stays beside the enforcing policy.
        $headers = self::managedHeadersBlock();
        $htaccess = self::replaceLegacyReportOnlyModule($htaccess, $headers) ?? $htaccess;

        return self::withManagedBlock($htaccess, 'wgw-headers', $headers);
    }

    private static function withManagedBlock(string $htaccess, string $name, string $block): string
    {
        $pattern = '/# BEGIN '.preg_quote($name, '/').'\R.*?# END '.preg_quote($name, '/').'/s';
        if (preg_match($pattern, $htaccess) === 1) {
            $replaced = preg_replace_callback($pattern, static fn (): string => $block, $htaccess, 1);

            return is_string($replaced) ? $replaced : $htaccess;
        }

        return self::insertManagedDenyBlock($htaccess, $block);
    }

    /**
     * Apache serves /index.html, /sw.js, /assets/* and the fonts without PHP, so the
     * security headers for those files have to be set here too. Generated from
     * SecurityHeaderPolicy so the policy has a single source of truth, and rewritten
     * on upgrade so existing installs do not keep an outdated policy. The comment
     * lives inside the markers so an upgrade keeps the proxy warning.
     */
    public static function managedHeadersBlock(): string
    {
        $hsts = SecurityHeaderPolicy::HSTS;
        $policy = SecurityHeaderPolicy::policy();

        return <<<BLOCK
# BEGIN wgw-headers
# Apache serves /index.html, /sw.js, /assets/*, and fonts without PHP, so HSTS and
# the CSP for those files have to be set here. Middleware still sets both when
# mod_headers is off. env=HTTPS is mod_ssl, when Apache itself terminates TLS. Behind
# a proxy that sends X-Forwarded-Proto, WGW_HTTPS covers the same header. Do not copy
# that proto into the HTTPS variable: PHP Request::isSecure() reads it and would ignore
# trustProxies. Browsers ignore HSTS on plain HTTP, so a spoofed proto does not stick.
# The served shell has no inline script, so the policy needs no hash and no nonce.
# Managed by WebRootDeny::managedHeadersBlock(); edits inside this block are overwritten on upgrade.
<IfModule mod_headers.c>
    <IfModule mod_setenvif.c>
        SetEnvIf X-Forwarded-Proto "^https\$" WGW_HTTPS=on
    </IfModule>
    Header always set Strict-Transport-Security "{$hsts}" env=HTTPS
    Header always set Strict-Transport-Security "{$hsts}" env=WGW_HTTPS
    <Files "index.html">
        Header always set Content-Security-Policy "{$policy}"
    </Files>
</IfModule>
# END wgw-headers
BLOCK;
    }

    private static function replaceLegacyReportOnlyModule(string $htaccess, string $block): ?string
    {
        $needle = '<IfModule mod_headers.c>';
        $offset = 0;
        $replacedAny = false;
        while (($start = strpos($htaccess, $needle, $offset)) !== false) {
            $end = self::ifModuleBlockEnd($htaccess, $start);
            if ($end === null) {
                return $replacedAny ? $htaccess : null;
            }
            $spanStart = self::legacyCommentStart($htaccess, $start);
            if (! str_contains(substr($htaccess, $spanStart, $end - $spanStart), 'Content-Security-Policy-Report-Only')) {
                $offset = $end;

                continue;
            }
            $insertion = str_ends_with($block, "\n") ? $block : $block."\n";
            $htaccess = substr($htaccess, 0, $spanStart).$insertion.substr($htaccess, $end);
            $replacedAny = true;
            $offset = $spanStart + strlen($insertion);
        }

        return $replacedAny ? $htaccess : null;
    }

    private static function legacyCommentStart(string $htaccess, int $moduleStart): int
    {
        $position = $moduleStart;
        $blockStart = $moduleStart;
        $sawReportOnly = false;
        while ($position > 0) {
            $previousBreak = strrpos(substr($htaccess, 0, $position - 1), "\n");
            $lineStart = $previousBreak === false ? 0 : $previousBreak + 1;
            $line = rtrim(substr($htaccess, $lineStart, $position - $lineStart), "\r\n");
            if ($line === '' || ! str_starts_with($line, '#')) {
                break;
            }
            if (str_contains($line, 'Report-only')) {
                $sawReportOnly = true;
            }
            $blockStart = $lineStart;
            if ($lineStart === 0) {
                break;
            }
            $position = $lineStart;
        }

        return $sawReportOnly ? $blockStart : $moduleStart;
    }

    private static function ifModuleBlockEnd(string $htaccess, int $start): ?int
    {
        $length = strlen($htaccess);
        $depth = 0;
        $i = $start;
        while ($i < $length) {
            if (substr_compare($htaccess, '<IfModule', $i, 9) === 0) {
                $depth++;
                $i += 9;

                continue;
            }
            if (substr_compare($htaccess, '</IfModule>', $i, 11) === 0) {
                $depth--;
                $i += 11;
                if ($depth === 0) {
                    if (($htaccess[$i] ?? '') === "\r") {
                        $i++;
                    }
                    if (($htaccess[$i] ?? '') === "\n") {
                        $i++;
                    }

                    return $i;
                }

                continue;
            }
            $i++;
        }

        return null;
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

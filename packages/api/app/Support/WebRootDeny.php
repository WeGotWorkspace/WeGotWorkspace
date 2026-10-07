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
}

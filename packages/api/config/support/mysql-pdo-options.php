<?php

declare(strict_types=1);
use Pdo\Mysql;

/**
 * MySQL PDO driver options compatible with PHP 8.3–8.5.
 *
 * PHP 8.5 deprecates PDO::MYSQL_ATTR_SSL_CA in favor of Pdo\Mysql::ATTR_SSL_CA.
 */
if (! function_exists('wgw_mysql_pdo_options')) {
    /** @return array<mixed> */
    function wgw_mysql_pdo_options(): array
    {
        if (! extension_loaded('pdo_mysql')) {
            return [];
        }

        $sslCa = env('MYSQL_ATTR_SSL_CA');
        if (! is_string($sslCa) || $sslCa === '') {
            return [];
        }

        if (class_exists(Mysql::class)) {
            $attribute = Mysql::ATTR_SSL_CA;
        } else {
            $attribute = PDO::MYSQL_ATTR_SSL_CA;
        }

        return [$attribute => $sslCa];
    }
}

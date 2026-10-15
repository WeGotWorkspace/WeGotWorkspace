<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Opts plugin REST and plugin HTML/asset serving in before the application boots.
 *
 * packages/api is a Laravel app. Routes load inside createApplication(), which
 * setUp() calls before the test body. Setting the flag after parent::setUp()
 * leaves the test hitting 404. phpdotenv does not override variables that are
 * already set, so putenv plus $_ENV and $_SERVER are visible at config load.
 *
 * If this still 404s, config:cache or route:cache ran first and Laravel ignored
 * the env override. Do not accept that 404.
 */
trait WithPluginsEnabled
{
    public function createApplication()
    {
        self::setPluginsEnabledEnv(true);

        return parent::createApplication();
    }

    public static function setPluginsEnabledEnv(bool $enabled): void
    {
        if ($enabled) {
            putenv('WGW_PLUGINS_ENABLED=true');
            $_ENV['WGW_PLUGINS_ENABLED'] = 'true';
            $_SERVER['WGW_PLUGINS_ENABLED'] = 'true';

            return;
        }

        putenv('WGW_PLUGINS_ENABLED');
        unset($_ENV['WGW_PLUGINS_ENABLED'], $_SERVER['WGW_PLUGINS_ENABLED']);
    }
}

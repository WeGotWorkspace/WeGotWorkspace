<?php

declare(strict_types=1);

namespace Tests\Support;

/**
 * Opts mailbox REST and MCP mail tools in before the application boots.
 *
 * packages/api is a Laravel app. Routes load inside createApplication(), which
 * setUp() calls before the test body. Setting the flag after parent::setUp()
 * leaves the test hitting 404. phpdotenv does not override variables that are
 * already set, so putenv plus $_ENV and $_SERVER are visible at config load.
 *
 * If this still 404s, config:cache or route:cache ran first and Laravel ignored
 * the env override. Do not accept that 404.
 */
trait WithMailClientEnabled
{
    public function createApplication()
    {
        self::setMailClientEnabledEnv(true);

        return parent::createApplication();
    }

    public static function setMailClientEnabledEnv(bool $enabled): void
    {
        if ($enabled) {
            putenv('WGW_MAIL_CLIENT_ENABLED=true');
            $_ENV['WGW_MAIL_CLIENT_ENABLED'] = 'true';
            $_SERVER['WGW_MAIL_CLIENT_ENABLED'] = 'true';

            return;
        }

        putenv('WGW_MAIL_CLIENT_ENABLED');
        unset($_ENV['WGW_MAIL_CLIENT_ENABLED'], $_SERVER['WGW_MAIL_CLIENT_ENABLED']);
    }
}

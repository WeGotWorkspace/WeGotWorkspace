<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Http\Request;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WithMailClientEnabled;

abstract class TestCase extends BaseTestCase
{
    protected function tearDown(): void
    {
        WithMailClientEnabled::setMailClientEnabledEnv(false);

        if ($this->app) {
            $this->beforeApplicationDestroyed(static function (): void {
                WgwInstallFixture::resetInstallEnv();
            });
        }

        parent::tearDown();

        WgwInstallFixture::resetInstallEnvAfterApplication();
        // TrustHosts writes a process-wide host list. A production-env test
        // leaves it set, and later tests then reject every other Host.
        Request::setTrustedHosts([]);
        // SabreWebdavFront copies Authorization into $_SERVER for CGI hosting.
        // PHPUnit keeps that for the next test in the same process.
        unset(
            $_SERVER['HTTP_AUTHORIZATION'],
            $_SERVER['REDIRECT_HTTP_AUTHORIZATION'],
            $_SERVER['PHP_AUTH_USER'],
            $_SERVER['PHP_AUTH_PW'],
        );
    }
}

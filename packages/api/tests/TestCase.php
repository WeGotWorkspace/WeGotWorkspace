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
    }
}

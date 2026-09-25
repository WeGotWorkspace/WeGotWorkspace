<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
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
    }
}

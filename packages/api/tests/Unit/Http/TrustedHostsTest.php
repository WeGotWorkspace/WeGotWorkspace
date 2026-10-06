<?php

declare(strict_types=1);

namespace Tests\Unit\Http;

use Illuminate\Http\Middleware\TrustHosts;
use Tests\TestCase;

final class TrustedHostsTest extends TestCase
{
    public function test_trusted_hosts_are_the_configured_app_url_host_and_loopback(): void
    {
        config(['app.url' => 'https://wgw.example.test']);

        $hosts = app(TrustHosts::class)->hosts();

        $this->assertSame([
            '^wgw\.example\.test$',
            '^localhost$',
            '^127\.0\.0\.1$',
            '^\:\:1$',
        ], $hosts);
    }
}

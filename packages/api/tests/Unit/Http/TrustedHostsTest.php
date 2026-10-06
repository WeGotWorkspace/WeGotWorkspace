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

    public function test_loopback_app_url_does_not_restrict_hosts(): void
    {
        config(['app.url' => 'http://localhost']);

        $this->assertSame([], app(TrustHosts::class)->hosts());
    }

    public function test_extra_trusted_hosts_are_added(): void
    {
        config([
            'app.url' => 'https://wgw.example.test',
            'wgw.trusted_hosts' => 'www.wgw.example.test, 203.0.113.10',
        ]);

        $hosts = app(TrustHosts::class)->hosts();

        $this->assertContains('^www\.wgw\.example\.test$', $hosts);
        $this->assertContains('^203\.0\.113\.10$', $hosts);
        $this->assertContains('^wgw\.example\.test$', $hosts);
    }
}

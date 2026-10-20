<?php

declare(strict_types=1);

namespace Tests\Unit\Support;

use App\Support\PublicAppUrl;
use Tests\TestCase;

final class PublicAppUrlTest extends TestCase
{
    public function test_a_loopback_app_url_counts_as_unset(): void
    {
        foreach (['http://localhost:8080', 'http://127.0.0.1', 'http://[::1]:8080', 'HTTP://LOCALHOST'] as $url) {
            config(['app.url' => $url]);
            $this->assertFalse(PublicAppUrl::isConfigured(), $url);
            $this->assertSame([], PublicAppUrl::trustedHostPatterns(), $url);
        }
    }

    public function test_a_public_app_url_is_configured(): void
    {
        foreach (['https://team.example.org', 'http://192.168.1.5:8080', 'http://[2001:db8::1]'] as $url) {
            config(['app.url' => $url]);
            $this->assertTrue(PublicAppUrl::isConfigured(), $url);
        }
    }

    public function test_an_empty_app_url_is_unset(): void
    {
        config(['app.url' => '']);

        $this->assertFalse(PublicAppUrl::isConfigured());
    }
}

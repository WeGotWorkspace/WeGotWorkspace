<?php

declare(strict_types=1);

namespace Tests\Unit\Mcp;

use App\Services\Mcp\McpRedirectUris;
use PHPUnit\Framework\TestCase;

final class McpRedirectUrisTest extends TestCase
{
    public function test_https_public_hosts_are_allowed(): void
    {
        $this->assertTrue(McpRedirectUris::isAllowed('https://claude.ai/oauth/callback'));
        $this->assertSame('https://claude.ai', McpRedirectUris::originOf('https://claude.ai/oauth/callback'));
    }

    public function test_loopback_ip_literals_are_allowed(): void
    {
        $this->assertTrue(McpRedirectUris::isAllowed('http://127.0.0.1:54321/callback'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://[::1]:54321/callback'));
    }

    public function test_localhost_hostname_is_rejected(): void
    {
        $this->assertFalse(McpRedirectUris::isAllowed('http://localhost:54321/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('https://localhost/callback'));
    }

    public function test_private_https_ips_are_rejected(): void
    {
        $this->assertFalse(McpRedirectUris::isAllowed('https://10.0.0.1/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('https://192.168.1.8/callback'));
        $this->assertFalse(McpRedirectUris::isPublicIp('127.0.0.1'));
    }
}

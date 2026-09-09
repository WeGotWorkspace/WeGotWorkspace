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
        $this->assertSame('claude.ai', McpRedirectUris::displayHost('https://claude.ai'));
        $this->assertSame('claude.ai', McpRedirectUris::displayHost('https://claude.ai/oauth/callback'));
    }

    public function test_http_native_app_loopback_hosts_are_allowed(): void
    {
        $this->assertTrue(McpRedirectUris::isAllowed('http://127.0.0.1:54321/callback'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://[::1]:54321/callback'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://localhost:54321/callback'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://localhost/callback'));
    }

    public function test_chatgpt_cimd_loopback_mix_is_allowed(): void
    {
        $this->assertTrue(McpRedirectUris::isAllowed('http://127.0.0.1/callback/t-7TrfN7xkBK'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://localhost/callback/t-7TrfN7xkBK'));
        $this->assertTrue(McpRedirectUris::isAllowed('http://127.0.0.1:59778/callback/t-7TrfN7xkBK'));
    }

    public function test_private_use_uri_schemes_are_rejected(): void
    {
        $this->assertFalse(McpRedirectUris::isAllowed('chatgpt://callback/t-7TrfN7xkBK'));
        $this->assertFalse(McpRedirectUris::isAllowed('com.openai.chat://auth'));
    }

    public function test_https_localhost_and_http_non_loopback_are_rejected(): void
    {
        $this->assertFalse(McpRedirectUris::isAllowed('https://localhost/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('http://evil.example/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('http://192.168.1.8/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('http://10.0.0.1/callback'));
    }

    public function test_private_https_ips_are_rejected(): void
    {
        $this->assertFalse(McpRedirectUris::isAllowed('https://10.0.0.1/callback'));
        $this->assertFalse(McpRedirectUris::isAllowed('https://192.168.1.8/callback'));
        $this->assertFalse(McpRedirectUris::isPublicIp('127.0.0.1'));
    }
}

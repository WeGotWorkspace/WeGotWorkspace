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

    public function test_carrier_grade_nat_and_tunnel_prefixes_are_not_public(): void
    {
        $blocked = [
            '100.64.0.1',
            '100.100.100.200',
            '100.127.255.255',
            '64:ff9b::a9fe:a9fe',
            '64:ff9b::7f00:1',
            '2002:7f00:1::',
            '2002:a9fe:a9fe::',
            '::ffff:127.0.0.1',
            '::ffff:169.254.169.254',
            '::ffff:7f00:1',
        ];
        foreach ($blocked as $ip) {
            $this->assertFalse(McpRedirectUris::isPublicIp($ip), $ip);
        }
        $this->assertTrue(McpRedirectUris::isPublicIp('100.128.0.1'));
        $this->assertTrue(McpRedirectUris::isPublicIp('64:ff9b::808:808'));
        $this->assertFalse(McpRedirectUris::isPublicIp('::ffff:8.8.8.8'));
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\System;

use Tests\TestCase;

final class SystemEndpointsTest extends TestCase
{
    public function test_health_returns_ok_payload(): void
    {
        $response = $this->getJson('/api/v1/health');
        $response->assertOk();
        $response->assertJsonStructure(['status', 'apiVersion', 'timestamp']);
        $this->assertSame('ok', $response->json('status'));
        $this->assertSame('v1', $response->json('apiVersion'));
    }

    public function test_capabilities_lists_auth_and_domains(): void
    {
        $response = $this->getJson('/api/v1/capabilities');
        $response->assertOk();
        $response->assertJsonStructure([
            'apiVersion',
            'auth' => ['type', 'tokenEndpoint', 'refreshEndpoint', 'revokeEndpoint', 'jwksEndpoint', 'passwordRecovery'],
            'domains',
        ]);
        $this->assertSame('bearer-jwt-rs256', $response->json('auth.type'));
        $this->assertFalse($response->json('auth.passwordRecovery'));
        $names = array_column($response->json('domains'), 'name');
        $this->assertContains('settings', $names);
    }
}

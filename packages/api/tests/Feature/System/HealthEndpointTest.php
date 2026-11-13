<?php

declare(strict_types=1);

namespace Tests\Feature\System;

use Tests\TestCase;

final class HealthEndpointTest extends TestCase
{
    public function test_health_returns_ok_payload(): void
    {
        $response = $this->getJson('/api/v1/health');

        $response->assertOk()
            ->assertJsonStructure(['status', 'apiVersion', 'timestamp'])
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('apiVersion', 'v1');
    }

    public function test_up_fails_while_the_data_directory_is_not_writable(): void
    {
        $this->get('/up')->assertOk();

        config(['wgw.data_dir' => '/nonexistent/wgw-content']);

        $this->get('/up')->assertServerError();
    }
}

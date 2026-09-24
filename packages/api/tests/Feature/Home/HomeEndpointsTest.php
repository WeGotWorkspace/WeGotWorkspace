<?php

declare(strict_types=1);

namespace Tests\Feature\Home;

use Tests\Support\WgwDatabaseTestCase;

final class HomeEndpointsTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->configureWgwJwtKeys();
        $this->seedAlice();
    }

    public function test_home_state_requires_auth_and_returns_availability(): void
    {
        $this->getJson('/api/v1/workspace/state')->assertUnauthorized();

        $token = $this->issueBearerToken();

        $this->setAppSetting('files_enabled', true);

        $response = $this->withBearer($token)->getJson('/api/v1/workspace/state');

        $response->assertOk()
            ->assertJsonPath('username', 'alice')
            ->assertJsonPath('isAdmin', false)
            ->assertJsonPath('availability.mail', false)
            ->assertJsonStructure([
                'availability' => [
                    'filesEnabled',
                    'drive',
                    'mail',
                    'meet',
                    'notes',
                ],
            ]);
    }

    private function seedAlice(): void
    {
        $this->seedWgwUser('alice', displayName: 'Alice');
    }
}

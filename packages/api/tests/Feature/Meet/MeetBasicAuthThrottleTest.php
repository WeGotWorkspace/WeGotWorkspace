<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

final class MeetBasicAuthThrottleTest extends WgwDatabaseTestCase
{
    private const string ROOM_ID = 'abcd-efgh-jklm';

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['env'] = 'production';
        putenv('WGW_DISABLE_LOGIN_THROTTLE');
        unset($_ENV['WGW_DISABLE_LOGIN_THROTTLE'], $_SERVER['WGW_DISABLE_LOGIN_THROTTLE']);
        config(['wgw.auth_realm' => 'SabreDAV']);
        $this->seedWgwUser('alice', displayName: 'Alice');
        $this->seedWgwUser('bob', displayName: 'Bob');
    }

    public function test_failed_meet_basic_auth_returns_429_and_spares_another_user(): void
    {
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->room('alice', 'wrong')->assertNotFound();
        }

        $this->room('alice', 'wrong')
            ->assertStatus(429)
            ->assertJson([
                'error' => 'Too many login attempts. Please try again later.',
                'code' => 'throttled',
            ]);

        $this->room('bob', 'secret')->assertNotFound();
    }

    private function room(string $username, string $password): TestResponse
    {
        return $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.20'])
            ->withHeaders([
                'Authorization' => 'Basic '.base64_encode($username.':'.$password),
            ])
            ->getJson('/api/v1/meetings/rooms/'.self::ROOM_ID);
    }
}

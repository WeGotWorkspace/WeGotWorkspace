<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareSessionRateLimitTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'rate-limit.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_share_session_endpoint_rate_limits_repeated_attempts(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/rate-limit.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'password' => 'correct-password',
        ])->assertOk();

        $publicToken = (string) $share->json('data.publicToken');

        for ($i = 0; $i < 10; $i++) {
            $this->postJson('/api/v1/files/share-sessions', [
                'token' => $publicToken,
                'password' => 'wrong-password',
            ])->assertUnauthorized();
        }

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'wrong-password',
        ])->assertStatus(429);
    }
}

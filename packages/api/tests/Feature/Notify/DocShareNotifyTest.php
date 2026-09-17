<?php

declare(strict_types=1);

namespace Tests\Feature\Notify;

use App\Models\Notification;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DocShareNotifyTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'shared.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_sharee_is_notified_and_actor_is_not(): void
    {
        $token = $this->userBearerToken();
        $this->withBearer($token)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'view'],
            ],
        ])->assertOk();

        $this->assertSame(1, Notification::query()->where('principal', 'alice')->where('action', 'shared')->count());
        $this->assertSame(0, Notification::query()->where('principal', 'bob')->where('action', 'shared')->count());

        $alice = $this->withBearer($this->issueBearerTokenFor('alice'))
            ->getJson('/api/v1/notifications')
            ->assertOk()
            ->json();
        $this->assertSame('/docs', $alice['list'][0]['navigate']);
        $this->assertSame('Bob shared shared.md with you', $alice['list'][0]['title']);
        $this->assertSame('/users/bob/shared.md', $alice['list'][0]['body']);
        $this->assertSame('Bob', $alice['list'][0]['data']['actor'] ?? null);
        $this->assertSame('/users/bob/shared.md', $alice['list'][0]['data']['path'] ?? null);
        $this->assertSame('shared.md', $alice['list'][0]['data']['fileName'] ?? null);
    }
}

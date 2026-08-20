<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Services\Auth\JwtTokenService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareRouteAclTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'acl-target.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: array<string, mixed>|null}>
     */
    public static function driveGuestAuthRoutesProvider(): iterable
    {
        yield 'GET children' => ['GET', '/api/v1/files/children?path=/users/bob', null];
        yield 'GET content' => ['GET', '/api/v1/files/content?path=/users/bob/acl-target.md', null];
    }

    #[DataProvider('driveGuestAuthRoutesProvider')]
    public function test_non_drive_guest_jwt_is_denied_on_broadened_drive_routes(
        string $method,
        string $uri,
        ?array $body,
    ): void {
        $foreignGuestToken = app(JwtTokenService::class)->issue([
            'sub' => 'meet:peer-alpha',
            'role' => 'guest',
            'exp' => time() + 3600,
        ]);

        $response = $this->withBearer($foreignGuestToken)->json($method, $uri, $body ?? []);
        $response->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }
}

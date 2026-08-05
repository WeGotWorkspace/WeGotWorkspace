<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShareSession;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareSessionTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'guest-note.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_public_share_session_exchanges_for_guest_jwt_and_allows_view_routes(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $publicToken = (string) $share->json('data.publicToken');

        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ]);
        $session->assertOk()
            ->assertJsonPath('role', 'guest');

        $guestJwt = (string) $session->json('access_token');
        $username = (string) $session->json('username');
        $this->assertMatchesRegularExpression('/^share:[a-f0-9]{32}$/', $username);

        $sessionKey = substr($username, strlen('share:'));
        $this->assertNotNull(
            DriveShareSession::query()->where('session_key', $sessionKey)->first(),
            'JWT sub must reference session_key, not primary key'
        );

        $this->withBearer($guestJwt)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk()
            ->assertJsonFragment(['name' => 'guest-note.md']);

        $this->withBearer($guestJwt)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'blocked.md',
            'type' => 'file',
        ])->assertStatus(400);
    }

    public function test_public_share_password_protects_session_exchange(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'password' => 'super-secret',
        ])->assertOk();

        $publicToken = (string) $share->json('data.publicToken');

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'wrong',
        ])->assertUnauthorized()
            ->assertJsonPath('code', 'share_password_invalid');

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertUnauthorized()
            ->assertJsonPath('code', 'share_password_required');

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'super-secret',
        ])->assertOk();
    }

    public function test_invalid_share_token_returns_unavailable(): void
    {
        $this->postJson('/api/v1/files/share-sessions', [
            'token' => 'deadbeefdeadbeefdeadbeefdeadbeef',
        ])->assertNotFound()
            ->assertJsonPath('code', 'share_unavailable');
    }

    public function test_revoked_public_share_returns_unavailable(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'password' => 'super-secret',
        ])->assertOk();

        $publicToken = (string) $share->json('data.publicToken');
        $shareId = (string) $share->json('data.id');

        $this->withBearer($ownerToken)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertStatus(410)
            ->assertJsonPath('code', 'share_unavailable')
            ->assertJsonPath('error', 'This share link is no longer available.');
    }
}

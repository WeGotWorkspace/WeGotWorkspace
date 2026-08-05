<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareSessionRevocationTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'revoke.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_revoked_share_denies_existing_guest_session_on_next_request(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $shareId = (string) $share->json('data.id');
        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk();

        $guestToken = (string) $session->json('access_token');
        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk();

        $this->withBearer($ownerToken)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }

    public function test_password_rotation_revokes_existing_sessions_immediately(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'password' => 'old-password',
        ])->assertOk();

        $shareId = (string) $share->json('data.id');
        $updatedAt = (string) $share->json('data.updatedAt');
        $publicToken = (string) $share->json('data.publicToken');
        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'old-password',
        ])->assertOk();

        $guestToken = (string) $session->json('access_token');
        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertOk();
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode('/users/bob/revoke.md'))
            ->assertOk();

        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'password' => 'new-password',
        ])->assertOk();

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertStatus(400);
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode('/users/bob/revoke.md'))
            ->assertStatus(400);

        // Reload of /share/:token must require the new password (no silent re-entry).
        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertUnauthorized()
            ->assertJsonPath('code', 'share_password_required');

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'old-password',
        ])->assertUnauthorized()
            ->assertJsonPath('code', 'share_password_invalid');

        $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
            'password' => 'new-password',
        ])->assertOk();
    }

    public function test_setting_password_on_unprotected_share_revokes_existing_sessions(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $shareId = (string) $share->json('data.id');
        $updatedAt = (string) $share->json('data.updatedAt');
        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk();

        $guestToken = (string) $session->json('access_token');
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode('/users/bob/revoke.md'))
            ->assertOk();

        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'password' => 'now-required',
        ])->assertOk();

        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode('/users/bob/revoke.md'))
            ->assertStatus(400);
    }
}

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

    private const SHARE_ROOT = '/users/bob/shared';

    private const SHARE_FILE = self::SHARE_ROOT.'/revoke.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $token = $this->userBearerToken();
        $this->withBearer($token)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'shared',
        ])->assertOk();
        $this->createDriveFile($token, self::SHARE_ROOT, 'revoke.md');
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
            'path' => self::SHARE_ROOT,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $shareId = (string) $share->json('data.id');
        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk();

        $guestToken = (string) $session->json('access_token');
        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)
            ->assertOk();

        $this->withBearer($ownerToken)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)
            ->assertStatus(400)
            ->assertJsonPath('error', 'Access denied for this path.');
    }

    public function test_password_rotation_revokes_existing_sessions_immediately(): void
    {
        $ownerToken = $this->userBearerToken();
        $share = $this->withBearer($ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
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
        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)
            ->assertOk();
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode(self::SHARE_FILE))
            ->assertOk();

        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'password' => 'new-password',
        ])->assertOk();

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)
            ->assertStatus(400);
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode(self::SHARE_FILE))
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
            'path' => self::SHARE_FILE,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $shareId = (string) $share->json('data.id');
        $updatedAt = (string) $share->json('data.updatedAt');
        $session = $this->postJson('/api/v1/files/share-sessions', [
            'token' => (string) $share->json('data.publicToken'),
        ])->assertOk();

        $guestToken = (string) $session->json('access_token');
        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode(self::SHARE_FILE))
            ->assertOk();

        $this->withBearer($ownerToken)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $updatedAt,
            'password' => 'now-required',
        ])->assertOk();

        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode(self::SHARE_FILE))
            ->assertStatus(400);
    }
}

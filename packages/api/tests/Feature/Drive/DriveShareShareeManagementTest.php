<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Only the owner manages a share. Someone the share grants access to gets 403 `forbidden`;
 * anyone else gets 404 `not_found`, the same as for an unknown share.
 */
final class DriveShareShareeManagementTest extends WgwDatabaseTestCase
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

    public function test_a_direct_sharee_is_forbidden_and_the_share_stays_unchanged(): void
    {
        $share = $this->createShare(['carol' => ['access' => 'edit']]);

        $this->assertManagementRefused($this->carolBearerToken(), $share, 403, 'forbidden');
        $this->assertShareUnchanged($share['id']);
    }

    public function test_a_sharee_through_a_group_is_forbidden(): void
    {
        $share = $this->createShare(['groups/team' => ['access' => 'view']]);

        $this->assertManagementRefused($this->adminBearerToken(), $share, 403, 'forbidden');
        $this->assertShareUnchanged($share['id']);
    }

    public function test_a_caller_the_share_does_not_involve_gets_not_found(): void
    {
        $share = $this->createShare(['carol' => ['access' => 'view']]);

        $this->assertManagementRefused($this->adminBearerToken(), $share, 404, 'not_found');
        $this->assertShareUnchanged($share['id']);
    }

    public function test_a_former_sharee_gets_not_found_after_the_owner_revokes(): void
    {
        $share = $this->createShare(['carol' => ['access' => 'view']]);
        $this->withBearer($this->userBearerToken())->deleteJson('/api/v1/files/shares/'.$share['id'])->assertOk();

        $this->withBearer($this->carolBearerToken())->getJson('/api/v1/files/shares/'.$share['id'])
            ->assertNotFound()
            ->assertJsonPath('code', 'not_found');
    }

    public function test_the_owner_still_manages_the_share(): void
    {
        $share = $this->createShare(['carol' => ['access' => 'view']]);
        $owner = $this->userBearerToken();

        $this->withBearer($owner)->getJson('/api/v1/files/shares/'.$share['id'])->assertOk();
        $this->withBearer($owner)->patchJson('/api/v1/files/shares/'.$share['id'], [
            'updatedAt' => $share['updatedAt'],
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])->assertOk()->assertJsonPath('data.shareWith.carol.access', 'edit');
        $this->withBearer($owner)->deleteJson('/api/v1/files/shares/'.$share['id'].'/invites/'.$share['inviteId'])
            ->assertOk();
        $this->withBearer($owner)->deleteJson('/api/v1/files/shares/'.$share['id'])->assertOk();
    }

    /**
     * @param  array<string, array{access: string}>  $shareWith
     * @return array{id: string, updatedAt: string, inviteId: string}
     */
    private function createShare(array $shareWith): array
    {
        $owner = $this->userBearerToken();
        $created = $this->withBearer($owner)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => $shareWith,
        ])->assertOk();
        $id = (string) $created->json('data.id');
        $invite = $this->withBearer($owner)->postJson('/api/v1/files/shares/'.$id.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'view',
        ])->assertOk();

        return [
            'id' => $id,
            'updatedAt' => (string) $this->withBearer($owner)->getJson('/api/v1/files/shares/'.$id)->json('data.updatedAt'),
            'inviteId' => (string) $invite->json('data.id'),
        ];
    }

    /**
     * @param  array{id: string, updatedAt: string, inviteId: string}  $share
     */
    private function assertManagementRefused(string $token, array $share, int $status, string $code): void
    {
        $base = '/api/v1/files/shares/'.$share['id'];
        $responses = [
            $this->withBearer($token)->getJson($base),
            $this->withBearer($token)->patchJson($base, [
                'updatedAt' => $share['updatedAt'],
                'shareWith' => ['carol' => ['access' => 'full'], 'alice' => ['access' => 'full']],
            ]),
            $this->withBearer($token)->postJson($base.'/invites', ['email' => 'other@example.com', 'access' => 'edit']),
            $this->withBearer($token)->deleteJson($base.'/invites/'.$share['inviteId']),
            $this->withBearer($token)->deleteJson($base),
        ];
        foreach ($responses as $response) {
            $response->assertStatus($status)->assertJsonPath('code', $code);
        }
    }

    private function assertShareUnchanged(string $shareId): void
    {
        $share = DriveShare::query()->findOrFail($shareId);
        $this->assertNull($share->revoked_at);
        $this->assertSame(0, DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('access', 'full')
            ->count());
        $this->assertSame(0, DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_email', 'other@example.com')
            ->count());
        $this->assertSame(1, DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_email', 'guest@example.com')
            ->where('status', 'pending')
            ->count());
    }
}

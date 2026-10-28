<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Models\Principal;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A share stays in force only while its owner still reaches the shared path. Once bob leaves
 * the team group, his shares on the team folder are dormant: hidden from his share management
 * and ignored for every grantee, invite and public link. Re-adding bob brings them back.
 */
final class DriveShareOwnerReachTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const BOX = '/groups/team/box';

    private const DOC = '/groups/team/box/doc.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->seedGroupFile('box/doc.md', 'team body');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_share_management_treats_a_dormant_share_as_not_found(): void
    {
        $bob = $this->userBearerToken();
        $share = $this->createBoxShare(['carol' => ['access' => 'view']]);
        $shareId = (string) $share['id'];
        $invite = $this->withBearer($bob)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'guest@example.com',
            'access' => 'view',
        ])->assertOk();
        $inviteId = (string) $invite->json('data.id');

        $this->removeBobFromTeam();

        $this->assertShareNotFound($this->withBearer($bob)->getJson('/api/v1/files/shares/'.$shareId));
        $this->assertShareNotFound($this->withBearer($bob)->patchJson('/api/v1/files/shares/'.$shareId, [
            'updatedAt' => $share['updatedAt'],
            'shareWith' => ['bob' => ['access' => 'full'], 'carol' => ['access' => 'full']],
        ]));
        $this->assertShareNotFound($this->withBearer($bob)->postJson('/api/v1/files/shares/'.$shareId.'/invites', [
            'email' => 'other@example.com',
            'access' => 'edit',
        ]));
        $this->assertShareNotFound(
            $this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareId.'/invites/'.$inviteId)
        );
        $this->assertShareNotFound($this->withBearer($bob)->deleteJson('/api/v1/files/shares/'.$shareId));

        $this->withBearer($bob)->getJson('/api/v1/files/shares')
            ->assertOk()
            ->assertJsonMissing(['id' => $shareId]);
        $this->withBearer($bob)->getJson('/api/v1/files/shares/by-principal?principal=carol')
            ->assertOk()
            ->assertJsonPath('data.entries', []);

        $this->assertSame(
            1,
            DriveShareGrant::query()->where('share_id', $shareId)->where('grantee_type', 'user')->count(),
            'A dormant share keeps its grants; nothing is changed or deleted.',
        );
    }

    public function test_grants_from_a_dormant_share_resolve_for_no_grantee(): void
    {
        $this->createBoxShare([
            'bob' => ['access' => 'full'],
            'carol' => ['access' => 'view'],
        ]);
        $carol = $this->carolBearerToken();
        $this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode(self::DOC))->assertOk();

        $this->removeBobFromTeam();

        $this->assertAccessDenied(
            $this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode(self::DOC))
        );
        $this->assertAccessDenied(
            $this->withBearer($this->userBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
        );
        $this->withBearer($carol)->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $this->withBearer($this->adminBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
            ->assertOk();
    }

    public function test_email_invites_and_public_links_of_a_dormant_share_are_refused(): void
    {
        $member = $this->createBoxShare(['guest@example.com' => ['access' => 'view']]);
        $grant = DriveShareGrant::query()
            ->where('share_id', (string) $member['id'])
            ->where('grantee_type', 'email')
            ->first();
        $this->assertNotNull($grant);
        $inviteToken = (string) $grant->displayedInviteToken();

        $public = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::BOX,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();
        $publicToken = (string) $public->json('data.publicToken');
        $guestJwt = (string) $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertOk()
            ->json('access_token');
        $this->withBearer($guestJwt)->get('/api/v1/files/content?path='.urlencode(self::DOC))->assertOk();

        $this->removeBobFromTeam();

        $this->assertAccessDenied($this->withBearer($guestJwt)->get('/api/v1/files/content?path='.urlencode(self::DOC)));
        $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertStatus(410)
            ->assertJsonPath('code', 'share_unavailable');
        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => $inviteToken,
        ])->assertNotFound();
    }

    public function test_a_dormant_share_works_again_when_the_owner_regains_access(): void
    {
        $share = $this->createBoxShare(['carol' => ['access' => 'view']]);
        $shareId = (string) $share['id'];
        $this->removeBobFromTeam();

        $this->addBobToTeam();

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->assertJsonPath('data.id', $shareId);
        $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
            ->assertOk();
    }

    public function test_personal_shares_are_unaffected_by_group_removal(): void
    {
        $bob = $this->userBearerToken();
        $path = $this->seedPrivateFile('bob', 'own.md', 'own body');
        $shareId = (string) $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk()->json('data.id');

        $this->removeBobFromTeam();

        $this->withBearer($bob)->getJson('/api/v1/files/shares/'.$shareId)->assertOk();
        $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode($path))
            ->assertOk();
    }

    /**
     * @param  array<string, array{access: string}>  $shareWith
     * @return array<string, mixed>
     */
    private function createBoxShare(array $shareWith): array
    {
        /** @var array<string, mixed> $data */
        $data = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::BOX,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => $shareWith,
        ])->assertOk()->json('data');

        return $data;
    }

    private function assertShareNotFound(TestResponse $response): void
    {
        $response->assertNotFound()->assertJsonPath('code', 'not_found');
    }

    private function removeBobFromTeam(): void
    {
        GroupMember::query()
            ->where('principal_id', $this->principalId('principals/groups/team'))
            ->where('member_id', $this->principalId('principals/bob'))
            ->delete();
    }

    private function addBobToTeam(): void
    {
        $membership = new GroupMember;
        $membership->principal_id = $this->principalId('principals/groups/team');
        $membership->member_id = $this->principalId('principals/bob');
        $membership->save();
    }

    private function principalId(string $uri): int
    {
        $principal = Principal::query()->where('uri', $uri)->first();
        $this->assertNotNull($principal);

        return (int) $principal->id;
    }
}

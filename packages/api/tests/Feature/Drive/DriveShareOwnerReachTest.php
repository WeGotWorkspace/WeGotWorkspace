<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Models\GroupMember;
use App\Models\Principal;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A share stays in force only while its owner still reaches the shared path. Once bob leaves
 * the team group, his shares on the team folder are dormant: hidden from his share management
 * and ignored for every grantee, invite and public link. Re-adding bob brings them back.
 * Deleting the group revokes them for good: a new group under the same slug starts without them,
 * even once bob joins it. While bob's account is disabled all his shares are dormant too.
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
        $this->assertAccessDenied(
            $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
        );

        $this->addBobToTeam();

        $this->withBearer($this->userBearerToken())->getJson('/api/v1/files/shares/'.$shareId)
            ->assertOk()
            ->assertJsonPath('data.id', $shareId);
        $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
            ->assertOk();
    }

    public function test_deleting_the_group_revokes_its_shares_for_good(): void
    {
        $bob = $this->userBearerToken();
        $admin = $this->adminBearerToken();
        $shareId = (string) $this->createBoxShare([
            'carol' => ['access' => 'view'],
            'guest@example.com' => ['access' => 'view'],
        ])['id'];
        $inviteGrant = DriveShareGrant::query()
            ->where('share_id', $shareId)
            ->where('grantee_type', 'email')
            ->first();
        $this->assertNotNull($inviteGrant);
        $inviteToken = (string) $inviteGrant->displayedInviteToken();
        $publicToken = (string) $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => self::BOX,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $guestJwt = (string) $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertOk()
            ->json('access_token');

        $this->withBearer($admin)->postJson('/api/v1/admin/groups', ['name' => 'team-two'])->assertOk();
        $this->withBearer($admin)->putJson('/api/v1/admin/groups/team-two/members/bob')->assertOk();
        app(WgwStorage::class)->files()->put('groups/team-two/box/doc.md', 'other body');
        $siblingShareId = (string) $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => '/groups/team-two/box',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk()->json('data.id');

        $this->withBearer($admin)->deleteJson('/api/v1/admin/groups/team')->assertOk();

        $this->assertSame(
            [$siblingShareId],
            DriveShare::query()->whereNull('revoked_at')->pluck('id')->map(fn ($id): string => (string) $id)->all(),
            'Only shares on the deleted group\'s folder are revoked.',
        );

        $this->withBearer($admin)->postJson('/api/v1/admin/groups', [
            'name' => 'team',
            'displayName' => 'Team',
        ])->assertOk();
        $this->withBearer($admin)->putJson('/api/v1/admin/groups/team/members/bob')->assertOk();
        $this->seedGroupFile('box/doc.md', 'new team body');

        $this->assertShareNotFound($this->withBearer($bob)->getJson('/api/v1/files/shares/'.$shareId));
        $this->assertAccessDenied(
            $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
        );
        $this->assertSame(
            [$siblingShareId],
            $this->sharedWithCarolShareIds(),
            'Shared-with-me holds only the other group\'s share.',
        );
        $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertStatus(410)
            ->assertJsonPath('code', 'share_unavailable');
        $this->assertAccessDenied($this->withBearer($guestJwt)->get('/api/v1/files/content?path='.urlencode(self::DOC)));
        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => $inviteToken,
        ])->assertNotFound();

        $freshShareId = (string) $this->createBoxShare(['carol' => ['access' => 'view']])['id'];
        $this->withBearer($this->carolBearerToken())->get('/api/v1/files/content?path='.urlencode(self::DOC))
            ->assertOk();
        $this->assertEqualsCanonicalizing([$siblingShareId, $freshShareId], $this->sharedWithCarolShareIds());
    }

    public function test_shares_of_a_disabled_account_are_dormant_until_it_is_enabled(): void
    {
        $bob = $this->userBearerToken();
        $admin = $this->adminBearerToken();
        $ownPath = $this->seedPrivateFile('bob', 'own.md', 'own body');
        $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => $ownPath,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();
        $this->createBoxShare(['carol' => ['access' => 'view']]);
        $publicToken = (string) $this->withBearer($bob)->postJson('/api/v1/files/shares', [
            'path' => $ownPath,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk()->json('data.publicToken');
        $guestJwt = (string) $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertOk()
            ->json('access_token');

        $this->withBearer($admin)->patchJson('/api/v1/admin/users/bob', ['enabled' => false])->assertOk();

        $carol = $this->carolBearerToken();
        $this->assertAccessDenied($this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode($ownPath)));
        $this->assertAccessDenied($this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode(self::DOC)));
        $this->assertSame([], $this->sharedWithCarolShareIds());
        $this->assertAccessDenied($this->withBearer($guestJwt)->get('/api/v1/files/content?path='.urlencode($ownPath)));
        $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])
            ->assertStatus(410)
            ->assertJsonPath('code', 'share_unavailable');
        $this->assertSame(0, DriveShare::query()->whereNotNull('revoked_at')->count(), 'Nothing is revoked.');

        $this->withBearer($admin)->patchJson('/api/v1/admin/users/bob', ['enabled' => true])->assertOk();

        $this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode($ownPath))->assertOk();
        $this->withBearer($carol)->get('/api/v1/files/content?path='.urlencode(self::DOC))->assertOk();
        $this->assertCount(2, $this->sharedWithCarolShareIds());
        $this->postJson('/api/v1/files/share-sessions', ['token' => $publicToken])->assertOk();
    }

    public function test_owner_group_memberships_load_once_per_request(): void
    {
        foreach (['box', 'box2', 'box3'] as $folder) {
            $this->seedGroupFile($folder.'/doc.md', 'team body');
            $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
                'path' => '/groups/team/'.$folder,
                'kind' => 'member',
                'defaultAccess' => 'view',
                'shareWith' => ['carol' => ['access' => 'view']],
            ])->assertOk();
        }
        $carol = $this->carolBearerToken();
        $connection = DB::connection('wgw');
        $connection->flushQueryLog();
        $connection->enableQueryLog();

        $this->withBearer($carol)->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->assertJsonCount(3, 'data');

        $ownerMembershipQueries = array_filter(
            $connection->getQueryLog(),
            static fn (array $query): bool => str_contains((string) $query['query'], 'groupmembers')
                && in_array('principals/bob', $query['bindings'], true),
        );
        $connection->disableQueryLog();
        $this->assertCount(1, $ownerMembershipQueries);
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

    /**
     * @return list<string>
     */
    private function sharedWithCarolShareIds(): array
    {
        $rows = (array) $this->withBearer($this->carolBearerToken())->getJson('/api/v1/files/shared-with-me')
            ->assertOk()
            ->json('data');

        return array_values(array_map(static fn (mixed $row): string => (string) ($row['share']['id'] ?? ''), $rows));
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

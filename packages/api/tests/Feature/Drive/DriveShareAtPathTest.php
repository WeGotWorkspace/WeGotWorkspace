<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Models\DriveShareGrant;
use App\Models\Principal;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareAtPathTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->createDriveFile($this->ownerToken, '/users/bob', 'draft.md');
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'projects',
        ])->assertOk();
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob/projects', [
            'name' => 'q3',
        ])->assertOk();
        $this->createDriveFile($this->ownerToken, '/users/bob/projects/q3', 'draft.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_at_path_returns_direct_covering_nested_and_effective_grants(): void
    {
        $ancestor = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'groups/team' => ['access' => 'view'],
            ],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $directMember = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => [
                'alice' => ['access' => 'full'],
                'carol@example.com' => ['access' => 'view'],
            ],
        ])->assertOk();

        $directPublic = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $nested = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk()
            ->assertJsonPath('data.path', '/users/bob/projects/q3');

        $directIds = array_column((array) $response->json('data.directShares'), 'share');
        $directShareIds = array_column($directIds, 'id');
        $this->assertContains((string) $directPublic->json('data.id'), $directShareIds);
        $this->assertContains((string) $directMember->json('data.id'), $directShareIds);
        $this->assertCount(2, $directShareIds);

        $coveringIds = array_column((array) $response->json('data.coveringShares'), 'share');
        $coveringShareIds = array_column($coveringIds, 'id');
        $this->assertContains((string) $ancestor->json('data.id'), $coveringShareIds);
        $this->assertCount(2, $coveringShareIds);

        $nestedIds = array_column((array) $response->json('data.nestedShares'), 'share');
        $this->assertSame(
            (string) $nested->json('data.id'),
            (string) ($nestedIds[0]['id'] ?? '')
        );

        $effective = (array) $response->json('data.effectiveGrants');
        $principals = array_column($effective, 'principal');
        $this->assertContains('alice', $principals);
        $this->assertContains('groups/team', $principals);
        $this->assertContains('carol@example.com', $principals);

        $directMember->assertJsonMissingPath('data.shareWith.carol@example.com');

        $publicShares = (array) $response->json('data.publicShares');
        $this->assertCount(2, $publicShares);
    }

    public function test_expired_covering_share_visible_but_excluded_from_effective_grants(): void
    {
        $expired = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'expiresAt' => Carbon::now()->subHour()->toISOString(),
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        );
        $response->assertOk()
            ->assertJsonPath('data.coveringShares.0.status', 'expired')
            ->assertJsonPath('data.coveringShares.0.share.id', (string) $expired->json('data.id'));

        $principals = array_column((array) $response->json('data.effectiveGrants'), 'principal');
        $this->assertNotContains('alice', $principals);
    }

    public function test_pending_email_only_in_effective_grants_not_share_with(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'view'],
                'pending@example.com' => ['access' => 'view'],
            ],
        ])->assertOk()
            ->assertJsonMissingPath('data.shareWith.pending@example.com');

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        );
        $response->assertOk();
        $principals = array_column((array) $response->json('data.effectiveGrants'), 'principal');
        $this->assertContains('pending@example.com', $principals);
    }

    public function test_non_owner_without_grant_gets_forbidden(): void
    {
        $this->withBearer($this->carolBearerToken())->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        )->assertStatus(403);
    }

    public function test_grantee_at_path_returns_my_rights_without_share_management(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($this->carolBearerToken())->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        )
            ->assertOk()
            ->assertJsonPath('data.myRights.mayView', true)
            ->assertJsonPath('data.myRights.mayComment', false)
            ->assertJsonPath('data.myRights.mayEditContent', false)
            ->assertJsonPath('data.myRights.mayShare', false)
            ->assertJsonPath('data.directShares', [])
            ->assertJsonPath('data.effectiveGrants', []);
    }

    public function test_at_path_route_not_shadowed_by_share_id_param(): void
    {
        $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        )->assertOk()
            ->assertJsonPath('data.path', '/users/bob/projects/q3/draft.md');
    }

    public function test_effective_grants_resolves_overlapping_user_grants(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'full']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceEntries = array_values(array_filter(
            (array) $response->json('data.effectiveGrants'),
            static fn (array $row): bool => ($row['principal'] ?? '') === 'alice',
        ));
        $this->assertCount(1, $aliceEntries);
        $this->assertSame('view', $aliceEntries[0]['access']);
    }

    public function test_grant_sources_lists_all_overlapping_rows(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'full']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceSources = array_values(array_filter(
            (array) $response->json('data.grantSources'),
            static fn (array $row): bool => ($row['principal'] ?? '') === 'alice',
        ));
        $this->assertCount(2, $aliceSources);
        $accessLevels = array_column($aliceSources, 'access');
        $this->assertContains('full', $accessLevels);
        $this->assertContains('view', $accessLevels);
    }

    public function test_effective_grants_resolves_overlapping_group_grants(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/team' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/team' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $groupEntries = array_values(array_filter(
            (array) $response->json('data.effectiveGrants'),
            static fn (array $row): bool => ($row['principal'] ?? '') === 'groups/team',
        ));
        $this->assertCount(1, $groupEntries);
        $this->assertSame('view', $groupEntries[0]['access']);
    }

    public function test_member_access_expands_group_with_via_group(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/team' => ['access' => 'edit']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceRow = collect((array) $response->json('data.memberAccess'))
            ->firstWhere('username', 'alice');
        $this->assertNotNull($aliceRow);
        $this->assertSame('edit', $aliceRow['access']);
        $this->assertSame('groups/team', $aliceRow['viaGroup']);
        $this->assertFalse($aliceRow['editable']);
        $this->assertSame('groupOnly', $aliceRow['editConstraint']);
    }

    public function test_member_access_direct_user_beats_group(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'alice' => ['access' => 'full'],
                'groups/team' => ['access' => 'view'],
            ],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceRow = collect((array) $response->json('data.memberAccess'))
            ->firstWhere('username', 'alice');
        $this->assertNotNull($aliceRow);
        $this->assertSame('full', $aliceRow['access']);
        $this->assertNull($aliceRow['viaGroup']);
        $this->assertTrue($aliceRow['editable']);
        $this->assertArrayNotHasKey('editConstraint', $aliceRow);
    }

    public function test_member_access_group_only_member_not_editable(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/team' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceRow = collect((array) $response->json('data.memberAccess'))
            ->firstWhere('username', 'alice');
        $this->assertNotNull($aliceRow);
        $this->assertFalse($aliceRow['editable']);
        $this->assertSame('groupOnly', $aliceRow['editConstraint']);
        $this->assertSame('groups/team', $aliceRow['viaGroup']);
    }

    public function test_member_access_batch_loads_groups_without_n_plus_one(): void
    {
        $staffGroup = $this->seedWgwGroup('principals/groups/staff', 'Staff');
        for ($i = 0; $i < 10; $i++) {
            $username = 'staff-member-'.$i;
            $this->seedWgwUser($username, displayName: 'Staff '.$i);
            $member = Principal::forUsername($username);
            $this->assertNotNull($member);
            $this->addPrincipalToGroup($staffGroup, $member);
        }

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/staff' => ['access' => 'edit']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['groups/staff' => ['access' => 'view']],
        ])->assertOk();

        DB::connection('wgw')->flushQueryLog();
        DB::connection('wgw')->enableQueryLog();

        $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        )->assertOk();

        $groupMemberQueries = 0;
        $driveSharesBatchQueries = 0;
        $driveShareGrantsBatchQueries = 0;
        foreach (DB::connection('wgw')->getQueryLog() as $query) {
            $sql = strtolower((string) ($query['query'] ?? ''));
            if (str_contains($sql, 'groupmembers')) {
                $groupMemberQueries++;
            }
            if (str_contains($sql, 'drive_shares') && (str_contains($sql, '"id" in (') || str_contains($sql, '`id` in ('))) {
                $driveSharesBatchQueries++;
            }
            if (str_contains($sql, 'drive_share_grants') && (str_contains($sql, '"share_id" in (') || str_contains($sql, '`share_id` in ('))) {
                $driveShareGrantsBatchQueries++;
            }
        }

        $this->assertLessThanOrEqual(1, $groupMemberQueries, 'Expected at most one groupmembers query for duplicate group slugs');
        $this->assertLessThanOrEqual(2, $driveSharesBatchQueries, 'Expected at most two batched drive_shares queries (scoped load + eager share)');
        $this->assertLessThanOrEqual(1, $driveShareGrantsBatchQueries, 'Expected at most one batched drive_share_grants query');
    }

    public function test_pending_email_includes_invite_id_and_delete_removal(): void
    {
        $create = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['pending@example.com' => ['access' => 'view']],
        ])->assertOk();

        $grant = DriveShareGrant::query()
            ->where('grantee_email', 'pending@example.com')
            ->where('status', 'pending')
            ->first();
        $this->assertNotNull($grant);

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        );
        $response->assertOk();

        $emailRow = collect((array) $response->json('data.effectiveGrants'))
            ->firstWhere('principal', 'pending@example.com');
        $this->assertNotNull($emailRow);
        $this->assertSame('pending', $emailRow['status']);
        $this->assertSame((string) $grant->id, $emailRow['inviteId']);
        $this->assertSame('deleteInvite', $emailRow['removal']['method']);
        $this->assertSame((string) $create->json('data.id'), $emailRow['removal']['shareId']);
    }

    public function test_accepted_guest_shows_patch_removal(): void
    {
        $create = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['guest@example.com' => ['access' => 'edit']],
        ])->assertOk();

        $grant = DriveShareGrant::query()
            ->where('grantee_email', 'guest@example.com')
            ->where('status', 'pending')
            ->first();
        $this->assertNotNull($grant);

        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/share-sessions/accept', [
            'inviteToken' => (string) $grant->invite_token,
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        );
        $response->assertOk();

        $carolRow = collect((array) $response->json('data.effectiveGrants'))
            ->firstWhere('principal', 'carol');
        $this->assertNotNull($carolRow);
        $this->assertSame('user', $carolRow['principalType']);
        $this->assertSame('guest@example.com', $carolRow['invitedEmail']);
        $this->assertSame('patchShareWith', $carolRow['removal']['method']);
        $this->assertSame('carol', $carolRow['removal']['principal']);
        $this->assertSame((string) $create->json('data.id'), $carolRow['removal']['shareId']);
    }

    public function test_nested_grant_appears_in_grant_sources_not_effective_grants(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $carolSources = array_values(array_filter(
            (array) $response->json('data.grantSources'),
            static fn (array $row): bool => ($row['principal'] ?? '') === 'carol',
        ));
        $this->assertCount(1, $carolSources);
        $this->assertTrue($carolSources[0]['source']['inherited']);
        $this->assertSame('active', $carolSources[0]['source']['status']);

        $carolEffective = array_values(array_filter(
            (array) $response->json('data.effectiveGrants'),
            static fn (array $row): bool => ($row['principal'] ?? '') === 'carol',
        ));
        $this->assertCount(0, $carolEffective);
    }

    public function test_expired_direct_and_covering_shares_in_grant_sources_with_source_status(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'expiresAt' => Carbon::now()->subHour()->toISOString(),
            'shareWith' => ['alice' => ['access' => 'view']],
        ])->assertOk();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'expiresAt' => Carbon::now()->subHour()->toISOString(),
            'shareWith' => ['carol' => ['access' => 'edit']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $aliceSource = collect((array) $response->json('data.grantSources'))
            ->firstWhere('principal', 'alice');
        $this->assertNotNull($aliceSource);
        $this->assertSame('expired', $aliceSource['source']['status']);
        $this->assertArrayNotHasKey('status', $aliceSource);

        $carolSource = collect((array) $response->json('data.grantSources'))
            ->firstWhere('principal', 'carol');
        $this->assertNotNull($carolSource);
        $this->assertSame('expired', $carolSource['source']['status']);
        $this->assertTrue($carolSource['source']['inherited']);
    }

    public function test_expired_nested_public_share_in_public_shares(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'public',
            'defaultAccess' => 'view',
            'expiresAt' => Carbon::now()->subHour()->toISOString(),
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3')
        );
        $response->assertOk();

        $publicShares = (array) $response->json('data.publicShares');
        $this->assertCount(1, $publicShares);
        $this->assertSame('expired', $publicShares[0]['status']);
        $this->assertTrue($publicShares[0]['inherited']);
        $this->assertSame('/users/bob/projects/q3/draft.md', $publicShares[0]['sharePath']);
    }

    public function test_pending_email_grant_source_status_active(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => '/users/bob/projects/q3/draft.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['pending@example.com' => ['access' => 'view']],
        ])->assertOk();

        $response = $this->withBearer($this->ownerToken)->getJson(
            '/api/v1/files/shares/at-path?path='.urlencode('/users/bob/projects/q3/draft.md')
        );
        $response->assertOk();

        $emailRow = collect((array) $response->json('data.grantSources'))
            ->firstWhere('principal', 'pending@example.com');
        $this->assertNotNull($emailRow);
        $this->assertSame('pending', $emailRow['status']);
        $this->assertSame('active', $emailRow['source']['status']);
    }
}

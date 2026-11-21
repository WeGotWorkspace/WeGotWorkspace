<?php

declare(strict_types=1);

namespace Tests\Feature\Teams;

use App\Models\Principal;
use App\Models\TeamAdmin;
use App\Services\Settings\GroupDirectoryService;
use App\Services\Teams\TeamMemberDirectory;
use App\Services\Teams\TeamRoles;
use Illuminate\Testing\TestResponse;
use Tests\Support\AdminTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #2278: member management by a team admin, and what the role does not reach.
 *
 * alice is organization admin and in no Team but the old Administrators one. bob is team
 * admin of T1; dave is a plain member of T1; carol is alone in T2; erin is in no Team.
 */
final class TeamAdminMemberWritesTest extends WgwDatabaseTestCase
{
    use AdminTestFixtures;

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpAdminFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave', email: 'dave@example.org');
        $this->seedWgwUser('erin', displayName: 'Erin Carolsen', email: 'erin@example.org');

        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $t1 = $this->seedWgwGroup('principals/groups/t1', 'T1');
        $t2 = $this->seedWgwGroup('principals/groups/t2', 'T2');
        $this->addPrincipalToGroup($t1, $this->principal('bob'));
        $this->addPrincipalToGroup($t1, $this->principal('dave'));
        $this->addPrincipalToGroup($t2, $this->principal('carol'));
        app(TeamRoles::class)->appoint('t1', 'bob');
    }

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_candidates_and_member_writes_need_the_role_for_that_team(): void
    {
        $calls = [
            'list members' => fn (string $team): TestResponse => $this->getJson("/api/v1/teams/{$team}/members"),
            'candidates' => fn (string $team): TestResponse => $this->getJson("/api/v1/teams/{$team}/member-candidates?q=er"),
            'add member' => fn (string $team): TestResponse => $this->putJson("/api/v1/teams/{$team}/members/erin"),
            'remove member' => fn (string $team): TestResponse => $this->deleteJson("/api/v1/teams/{$team}/members/dave"),
            'appoint' => fn (string $team): TestResponse => $this->putJson("/api/v1/teams/{$team}/admins/dave"),
            'dismiss' => fn (string $team): TestResponse => $this->deleteJson("/api/v1/teams/{$team}/admins/bob"),
        ];

        // dave: plain member of T1. carol: not in T1. bob: team admin of T1, not of T2.
        foreach ([['dave', 't1'], ['carol', 't1'], ['erin', 't1'], ['bob', 't2']] as [$caller, $team]) {
            foreach ($calls as $name => $call) {
                $this->asUser($caller);
                $refused = $call($team);
                $this->asUser($caller);
                $unknown = $call('nope');
                $refused->assertStatus(404);
                $this->assertSame(
                    $unknown->json(),
                    $refused->json(),
                    "{$caller} on {$team}: {$name} must answer like an unknown Team.",
                );
            }
        }

        $this->assertSame(['bob', 'dave'], $this->memberUsernames('t1'));
        $this->assertSame(['bob'], app(TeamRoles::class)->teamAdminsOf('t1'));
    }

    public function test_a_team_admin_manages_the_members_of_their_team(): void
    {
        $this->asUser('bob')->putJson('/api/v1/teams/t1/members/erin')->assertOk();
        $this->assertSame(['bob', 'dave', 'erin'], $this->memberUsernames('t1'));

        $list = $this->asUser('bob')->getJson('/api/v1/teams/t1/members')->assertOk()->json('list');
        $this->assertSame([
            ['username' => 'bob', 'displayName' => 'Bob', 'email' => (string) $this->principal('bob')->email, 'isTeamAdmin' => true],
            ['username' => 'dave', 'displayName' => 'Dave', 'email' => 'dave@example.org', 'isTeamAdmin' => false],
            ['username' => 'erin', 'displayName' => 'Erin Carolsen', 'email' => 'erin@example.org', 'isTeamAdmin' => false],
        ], $list);

        $erinTeams = $this->asUser('erin')->getJson('/api/v1/settings/state')->assertOk()->json('groups');
        $this->assertSame(['principals/groups/t1'], array_column($erinTeams, 'id'));
        $this->assertSame([false], array_column($erinTeams, 'isTeamAdmin'));

        $this->asUser('bob')->deleteJson('/api/v1/teams/t1/members/erin')->assertOk();
        $this->assertSame(['bob', 'dave'], $this->memberUsernames('t1'));
    }

    public function test_a_team_admin_appoints_and_dismisses_team_admins_of_their_team(): void
    {
        $this->asUser('bob')->putJson('/api/v1/teams/t1/admins/dave')->assertOk();
        $this->asUser('bob')->putJson('/api/v1/teams/t1/admins/dave')->assertOk();
        $this->assertSame(['bob', 'dave'], app(TeamRoles::class)->teamAdminsOf('t1'));
        $this->assertSame(
            [true],
            array_column($this->asUser('dave')->getJson('/api/v1/settings/state')->assertOk()->json('groups'), 'isTeamAdmin'),
        );

        // dave may now dismiss bob, and bob may dismiss themself.
        $this->asUser('dave')->deleteJson('/api/v1/teams/t1/admins/bob')->assertOk();
        $this->assertSame(['dave'], app(TeamRoles::class)->teamAdminsOf('t1'));
        $this->asUser('bob')->getJson('/api/v1/teams/t1/members')->assertStatus(404);

        // The last team admin stays: a Team never ends up without one through a dismissal.
        $this->asUser('dave')->deleteJson('/api/v1/teams/t1/admins/dave')
            ->assertStatus(409)->assertJsonPath('code', 'last_team_admin');
        $this->assertSame(['dave'], app(TeamRoles::class)->teamAdminsOf('t1'));
    }

    public function test_only_a_member_can_be_team_admin_and_only_a_real_user_can_be_added(): void
    {
        $this->asUser('bob')->putJson('/api/v1/teams/t1/admins/erin')
            ->assertStatus(409)->assertJsonPath('code', 'not_a_member');
        $this->asUser('bob')->putJson('/api/v1/teams/t1/admins/ghost')->assertStatus(404);
        $this->asUser('bob')->putJson('/api/v1/teams/t1/members/ghost')->assertStatus(404);
        $this->asUser('bob')->putJson('/api/v1/teams/t1/members/groups')->assertStatus(404);

        $this->assertSame(['bob', 'dave'], $this->memberUsernames('t1'));
        $this->assertSame(['bob'], app(TeamRoles::class)->teamAdminsOf('t1'));
    }

    public function test_the_role_goes_with_the_membership(): void
    {
        $roles = app(TeamRoles::class);
        $roles->appoint('t1', 'dave');

        // Removed through the team route.
        $this->asUser('bob')->deleteJson('/api/v1/teams/t1/members/dave')->assertOk();
        $this->assertSame(['bob'], $roles->teamAdminsOf('t1'));

        // Added back: a member again, not a team admin again.
        $this->asUser('bob')->putJson('/api/v1/teams/t1/members/dave')->assertOk();
        $this->assertFalse($roles->isTeamAdmin('dave', 't1'));

        // Removed by the organization admin's member list.
        $this->asUser('alice')->patchJson('/api/v1/admin/groups/t1', ['members' => ['dave']])->assertOk();
        $this->assertSame([], $roles->teamAdminsOf('t1'));
        $this->assertFalse(TeamAdmin::query()->where('username', 'bob')->exists());
    }

    public function test_a_stale_row_gives_no_role_without_membership(): void
    {
        TeamAdmin::query()->create(['group_slug' => 't2', 'username' => 'bob']);

        $roles = app(TeamRoles::class);
        $this->assertFalse($roles->isTeamAdmin('bob', 't2'));
        $this->assertFalse($roles->mayManageMembers('bob', 't2'));
        $this->assertFalse($roles->mayManageProjects('bob', 't2'));
        $this->assertFalse($roles->mayManageTeamCollections('bob', 't2'));
        $this->asUser('bob')->getJson('/api/v1/teams/t2/members')->assertStatus(404);
    }

    public function test_deleting_a_user_or_a_team_removes_their_rows(): void
    {
        app(TeamRoles::class)->appoint('t1', 'dave');

        $this->asUser('alice')->deleteJson('/api/v1/admin/users/dave')->assertOk();
        $this->assertSame(['bob'], app(TeamRoles::class)->teamAdminsOf('t1'));

        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1')->assertOk();
        $this->assertSame(0, TeamAdmin::query()->count());
    }

    public function test_an_organization_admin_manages_any_team_but_gets_no_project_or_collection_role(): void
    {
        $this->asUser('alice')->getJson('/api/v1/teams/t2/members')->assertOk()
            ->assertJsonPath('list.0.username', 'carol');
        $this->asUser('alice')->putJson('/api/v1/teams/t2/admins/carol')->assertOk();
        $this->asUser('alice')->putJson('/api/v1/teams/t2/members/erin')->assertOk();
        $this->asUser('alice')->getJson('/api/v1/teams/t2/member-candidates?q=dave')->assertOk()
            ->assertJsonPath('list.0.username', 'dave');

        $roles = app(TeamRoles::class);
        $this->assertSame(['carol'], $roles->teamAdminsOf('t2'));
        $this->assertTrue($roles->mayManageMembers('alice', 't2'));
        $this->assertFalse($roles->mayManageProjects('alice', 't2'));
        $this->assertFalse($roles->mayManageTeamCollections('alice', 't2'));
    }

    public function test_organization_admin_routes_are_unchanged(): void
    {
        $this->asUser('alice')->putJson('/api/v1/admin/groups/t1/members/erin')->assertOk();
        $this->assertSame(['bob', 'dave', 'erin'], $this->memberUsernames('t1'));
        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1/members/erin')->assertOk();
        $this->asUser('alice')->patchJson('/api/v1/admin/groups/t1', ['displayName' => 'Team One'])->assertOk();
        $this->assertSame(['bob', 'dave'], $this->memberUsernames('t1'));
        // A rename or a member add leaves the team admins alone.
        $this->assertSame(['bob'], app(TeamRoles::class)->teamAdminsOf('t1'));

        $groups = collect($this->asUser('alice')->getJson('/api/v1/admin/state')->assertOk()->json('groups'))->keyBy('name');
        $this->assertSame(['bob'], $groups['t1']['teamAdmins']);
        $this->assertSame([], $groups['t2']['teamAdmins']);

        // The admin prefix stays closed to a team admin.
        $this->asUser('bob')->putJson('/api/v1/admin/groups/t1/members/erin')->assertStatus(403);
    }

    public function test_candidates_match_name_username_and_email_and_flag_members(): void
    {
        $find = fn (string $q): array => array_column(
            $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q='.urlencode($q))->assertOk()->json('list'),
            'isMember',
            'username',
        );

        // "carol" is carol's username and part of erin's display name.
        $this->assertSame(['carol' => false, 'erin' => false], $find('CAROL'));
        $this->assertSame(['dave' => true], $find('dave@example'));
        $this->assertSame([], $find('t1'));
        $this->assertSame([], $find('%%'));

        $keys = array_keys($this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=er')->json('list.0'));
        $this->assertSame(['username', 'displayName', 'email', 'isMember'], $keys);
    }

    public function test_candidates_need_two_characters_and_are_capped_and_rate_limited(): void
    {
        $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=e')
            ->assertStatus(400)->assertJsonPath('code', 'invalidProperties');
        $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates')->assertStatus(400);

        for ($i = 0; $i < TeamMemberDirectory::CANDIDATE_LIMIT + 5; $i++) {
            $this->seedWgwUser('zz-user-'.$i, displayName: 'Zed '.$i);
        }
        $this->assertCount(
            TeamMemberDirectory::CANDIDATE_LIMIT,
            $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=zz-user')->assertOk()->json('list'),
        );

        // The three calls above each used one of the budget; a refused Team would not have.
        for ($i = 3; $i < TeamMemberDirectory::CANDIDATE_REQUESTS_PER_MINUTE; $i++) {
            $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=zz')->assertOk();
        }
        $this->asUser('bob')->getJson('/api/v1/teams/t1/member-candidates?q=zz')
            ->assertStatus(429)->assertHeader('Retry-After');
    }

    /**
     * @return list<string>
     */
    private function memberUsernames(string $slug): array
    {
        $uris = app(GroupDirectoryService::class)->memberPrincipalUris('principals/groups/'.$slug);
        $usernames = array_map(static fn (string $uri): string => basename($uri), $uris);
        sort($usernames);

        return $usernames;
    }

    private function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }

    private function principal(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }
}

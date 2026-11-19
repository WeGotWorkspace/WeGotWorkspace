<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use Illuminate\Testing\TestResponse;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817: who reads and who writes a Project. Reading is Team membership; writing is the
 * team-admin role for that Team. Everyone else gets the answer an unknown id gets.
 */
final class ProjectAccessTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    private const UNKNOWN_ID = '01hzzzzzzzzzzzzzzzzzzzzzzz';

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_non_member_and_unknown_id_answer_alike(): void
    {
        $id = (string) $this->createProject('bob', 't1', 'Launch')['id'];

        $calls = [
            'show' => fn (string $project): TestResponse => $this->getJson('/api/v1/projects/'.$project),
            'patch' => fn (string $project): TestResponse => $this->patchJson('/api/v1/projects/'.$project, ['name' => 'Taken over']),
        ];
        // carol: team admin of another Team. alice: organization admin outside T1. erin: in no Team.
        foreach (['carol', 'alice', 'erin'] as $caller) {
            foreach ($calls as $name => $call) {
                $this->asUser($caller);
                $refused = $call($id);
                $this->asUser($caller);
                $unknown = $call(self::UNKNOWN_ID);
                $refused->assertNotFound();
                $this->assertSame($unknown->json(), $refused->json(), "{$caller}: {$name} must answer like an unknown id.");
            }
            $this->assertSame([], $this->listProjects($caller)->assertOk()->json('list'), "{$caller} lists no Project of T1.");
        }

        $this->asUser('bob')->getJson('/api/v1/projects/'.$id)->assertOk()->assertJsonPath('name', 'Launch');
    }

    public function test_member_reads_and_only_the_team_admin_writes(): void
    {
        $id = (string) $this->createProject('bob', 't1', 'Launch')['id'];

        $list = $this->listProjects('dave')->assertOk()->json('list');
        $this->assertCount(1, $list);
        $this->assertSame($id, $list[0]['id']);
        $this->assertFalse($list[0]['mayManage']);
        $this->assertTrue($this->listProjects('bob')->json('list.0.mayManage'));

        $this->asUser('dave')->postJson('/api/v1/projects', ['teamSlug' => 't1', 'name' => 'Mine'])
            ->assertForbidden()
            ->assertJsonPath('code', 'team_admin_only');
        $this->asUser('dave')->patchJson('/api/v1/projects/'.$id, ['name' => 'Mine'])
            ->assertForbidden()
            ->assertJsonPath('code', 'team_admin_only');

        $this->assertSame('Launch', $this->listProjects('bob')->json('list.0.name'));
    }

    public function test_create_needs_membership_of_the_team(): void
    {
        $unknown = $this->asUser('bob')->postJson('/api/v1/projects', ['teamSlug' => 'nope', 'name' => 'X'])->assertNotFound();

        // bob is team admin of T1 only; alice is organization admin but in no Team.
        foreach ([['bob', 't2'], ['alice', 't1'], ['erin', 't1']] as [$caller, $team]) {
            $refused = $this->asUser($caller)->postJson('/api/v1/projects', ['teamSlug' => $team, 'name' => 'X'])->assertNotFound();
            $this->assertSame($unknown->json(), $refused->json(), "{$caller} on {$team}");
        }

        $this->asUser('bob')->postJson('/api/v1/projects', ['name' => 'X'])
            ->assertStatus(400)
            ->assertJsonPath('code', 'invalidProperties');
    }

    public function test_each_member_lists_only_the_projects_of_their_teams(): void
    {
        $this->createProject('bob', 't1', 'Launch');
        $this->createProject('carol', 't2', 'Studio work');

        $this->assertSame(['Launch'], array_column($this->listProjects('dave')->json('list'), 'name'));
        $this->assertSame(['Studio work'], array_column($this->listProjects('carol')->json('list'), 'name'));
    }
}

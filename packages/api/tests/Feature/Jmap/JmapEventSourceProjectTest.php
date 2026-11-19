<?php

declare(strict_types=1);

namespace Tests\Feature\Jmap;

use App\Services\Settings\GroupDirectoryService;
use Illuminate\Support\Facades\Cache;
use Tests\Feature\Projects\ProjectsWorld;
use Tests\Support\InteractsWithJmapEventSource;
use Tests\Support\WgwDatabaseTestCase;

/**
 * `Project` push state (#817): a hash over the caller's Team slugs and each Team's
 * Project marker. A Project write moves it for every member of that Team and nobody
 * else; joining a Team moves it too.
 */
final class JmapEventSourceProjectTest extends WgwDatabaseTestCase
{
    use InteractsWithJmapEventSource;
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_a_project_write_moves_the_state_of_the_team_members_only(): void
    {
        Cache::flush();
        $dave = $this->issueBearerTokenFor('dave');
        $carol = $this->issueBearerTokenFor('carol');
        $daveStart = $this->readEventSource($dave, 'Project');
        $carolStart = $this->readEventSource($carol, 'Project');
        $before = $this->changedStates($daveStart, 'dave')['Project'];

        $project = $this->createProject('bob', 't1', 'Launch');
        $afterCreate = $this->readEventSource($dave, 'Project', $daveStart['id']);
        $created = $this->changedStates($afterCreate, 'dave')['Project'] ?? null;
        $this->assertNotNull($created);
        $this->assertNotSame($before, $created);

        $this->asUser('bob')->patchJson('/api/v1/projects/'.$project['id'], ['name' => 'Big launch'])->assertOk();
        $afterPatch = $this->readEventSource($dave, 'Project', $afterCreate['id']);
        $this->assertNotSame($created, $this->changedStates($afterPatch, 'dave')['Project'] ?? $created);

        $carolNow = $this->readEventSource($carol, 'Project', $carolStart['id']);
        $this->assertSame([], $this->changedStates($carolNow, 'carol'), 'carol is in another Team.');
    }

    public function test_joining_a_team_moves_the_state(): void
    {
        Cache::flush();
        $erin = $this->issueBearerTokenFor('erin');
        $start = $this->readEventSource($erin, 'Project');

        app(GroupDirectoryService::class)->setMembership('principals/groups/t2', 'erin', true);

        $this->assertArrayHasKey('Project', $this->changedStates($this->readEventSource($erin, 'Project', $start['id']), 'erin'));
    }
}

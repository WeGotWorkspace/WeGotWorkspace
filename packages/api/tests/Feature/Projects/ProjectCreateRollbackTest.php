<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Models\CalendarInstance;
use App\Models\ChatChannelMeta;
use App\Models\Project;
use App\Models\ProjectResource;
use App\Services\Projects\ProjectCollections;
use App\Services\Projects\ProjectKind;
use App\Services\Projects\ProjectMarkers;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #817: create runs in one `wgw` transaction. A failure after the first collection
 * leaves no Project row, no registry row, no collection and no channel meta. CI runs
 * this file on sqlite and on MySQL (api-mysql).
 */
final class ProjectCreateRollbackTest extends WgwDatabaseTestCase
{
    use ProjectsWorld;

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    public function test_throw_after_first_collection_leaves_nothing(): void
    {
        // One stand-in for the whole test: the router keeps the controller, and with it the
        // collaborators, from the first request on.
        $collections = new FailingProjectCollections($this->app->build(ProjectCollections::class));
        $this->app->instance(ProjectCollections::class, $collections);

        foreach ([ProjectKind::TaskList, ProjectKind::Channel] as $failingKind) {
            $collections->failingKind = $failingKind;
            $instancesBefore = CalendarInstance::query()->count();
            $channelsBefore = ChatChannelMeta::query()->count();
            $attemptsBefore = count($collections->attempted);

            $this->asUser('bob')->postJson('/api/v1/projects', ['teamSlug' => 't1', 'name' => 'Launch'])
                ->assertStatus(500);

            $this->assertSame(
                array_slice(ProjectKind::collections(), 0, (int) array_search($failingKind, ProjectKind::collections(), true) + 1),
                array_slice($collections->attempted, $attemptsBefore),
                'Create got past the first collection before it failed.',
            );
            $this->assertSame(0, Project::query()->count(), $failingKind->value);
            $this->assertSame(0, ProjectResource::query()->count(), $failingKind->value);
            $this->assertSame($instancesBefore, CalendarInstance::query()->count(), $failingKind->value);
            $this->assertSame($channelsBefore, ChatChannelMeta::query()->count(), $failingKind->value);
            $this->assertSame(['t1' => 0], app(ProjectMarkers::class)->markersFor(['t1']), $failingKind->value);
        }

        // The next create works and takes the slug the failed ones would have had.
        $collections->failingKind = null;
        $this->assertSame('launch', $this->createProject('bob', 't1', 'Launch')['slug']);
    }
}

/** Passes every step to the real collaborator except the one it is told to fail. */
final class FailingProjectCollections extends ProjectCollections
{
    public ?ProjectKind $failingKind = null;

    /** @var list<ProjectKind> */
    public array $attempted = [];

    public function __construct(private readonly ProjectCollections $real) {}

    public function create(ProjectKind $kind, string $groupPrincipalUri, string $projectSlug, string $name, ?string $color): int
    {
        $this->attempted[] = $kind;
        if ($kind === $this->failingKind) {
            throw new \RuntimeException('Simulated failure creating '.$kind->value.'.');
        }

        return $this->real->create($kind, $groupPrincipalUri, $projectSlug, $name, $color);
    }
}

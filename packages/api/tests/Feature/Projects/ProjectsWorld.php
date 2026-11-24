<?php

declare(strict_types=1);

namespace Tests\Feature\Projects;

use App\Models\Principal;
use Illuminate\Testing\TestResponse;
use Tests\Support\AdminTestFixtures;

/**
 * The world of the Projects tests (#817).
 *
 * alice is organization admin and in no Team. bob is team admin of T1 and dave a plain
 * member of it. carol is team admin of T2. erin is in no Team.
 *
 * Laravel calls setUpProjectsWorld() itself (setUp + trait name); a test only tears down.
 */
trait ProjectsWorld
{
    use AdminTestFixtures;

    /** @var array<string, string> */
    private array $tokens = [];

    protected function setUpProjectsWorld(): void
    {
        $this->setUpAdminFixtures();
        $this->seedWgwUser('dave', displayName: 'Dave', email: 'dave@example.org');
        $this->seedWgwUser('erin', displayName: 'Erin', email: 'erin@example.org');

        Principal::query()->firstOrCreate(['uri' => 'principals/groups'], ['displayname' => 'Groups', 'email' => null]);
        $t1 = $this->seedWgwGroup('principals/groups/t1', 'T1');
        $t2 = $this->seedWgwGroup('principals/groups/t2', 'T2');
        $this->addPrincipalToGroup($t1, $this->principalOf('bob'));
        $this->addPrincipalToGroup($t1, $this->principalOf('dave'));
        $this->addPrincipalToGroup($t2, $this->principalOf('carol'));
        $this->appointTeamAdmin('t1', 'bob');
        $this->appointTeamAdmin('t2', 'carol');
    }

    protected function asUser(string $username): static
    {
        $this->tokens[$username] ??= $this->issueBearerTokenFor($username);

        return $this->withBearer($this->tokens[$username]);
    }

    /** @return array<string, mixed> the created Project */
    protected function createProject(string $caller, string $team, string $name, ?string $color = null): array
    {
        $payload = ['teamSlug' => $team, 'name' => $name];
        if ($color !== null) {
            $payload['color'] = $color;
        }
        $response = $this->asUser($caller)->postJson('/api/v1/projects', $payload);
        $response->assertCreated();

        /** @var array<string, mixed> */
        return $response->json();
    }

    protected function listProjects(string $caller, bool $archived = false): TestResponse
    {
        return $this->asUser($caller)->getJson('/api/v1/projects'.($archived ? '?archived=1' : ''));
    }

    private function principalOf(string $username): Principal
    {
        $principal = Principal::forUsername($username);
        $this->assertNotNull($principal);

        return $principal;
    }
}

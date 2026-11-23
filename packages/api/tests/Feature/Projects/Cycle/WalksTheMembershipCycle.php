<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use App\Models\Project;
use App\Services\Chat\ChatGroupDefaultChannelProvisioner;
use App\Services\Contacts\AddressBookProvisioner;
use App\Services\Jmap\JmapCapabilities;
use Tests\Feature\Projects\ProjectsWorld;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The membership cycle of #819, for one Team (T1) and one of its Projects, in one app.
 *
 * dave is a member of T1 from the start, fred joins and leaves, erin is in no Team, and
 * alice is organization admin and bob the team admin of T1 (he purges). A test class
 * says what each user sees of the Project's content, and of the Team's own asset that
 * outlives the Project, through its app's reads. `null` means the app has no such thing.
 *
 * @phpstan-require-extends WgwDatabaseTestCase
 */
trait WalksTheMembershipCycle
{
    use ProjectsWorld;

    /** @var array<string, mixed> */
    protected array $project = [];

    protected function tearDown(): void
    {
        $this->tearDownAdminFixtures();
        parent::tearDown();
    }

    /** Make the content the app keeps in the Project. */
    protected function seedProjectContent(): void {}

    /** What `$user` sees of the Project's content in this app. */
    abstract protected function seesProjectContent(string $user): ?bool;

    /** What `$user` sees of the Team's own asset in this app: the address book, the Team Drive, the Team channel. */
    protected function seesTeamAsset(string $user): ?bool
    {
        return null;
    }

    protected function walkTheCycle(): void
    {
        $this->seedWgwUser('fred', displayName: 'Fred', email: 'fred@example.org');
        app(AddressBookProvisioner::class)->ensureForGroupPrincipal('principals/groups/t1', 'T1');
        app(ChatGroupDefaultChannelProvisioner::class)->ensureForGroupSlugs(['t1']);
        $this->project = $this->createProject('bob', 't1', 'Launch');
        $this->seedProjectContent();

        $this->assertViews('start', content: ['bob' => true, 'dave' => true, 'fred' => false, 'erin' => false], team: ['dave' => true, 'fred' => false, 'erin' => false]);

        // 1. Add a member: they see what is there, the outsider does not.
        $this->asUser('alice')->putJson('/api/v1/admin/groups/t1/members/fred')->assertOk();
        $this->assertViews('member added', content: ['fred' => true, 'dave' => true, 'erin' => false], team: ['fred' => true, 'dave' => true, 'erin' => false]);

        // 2. Remove that member: they lose it all, the outsider still has nothing.
        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1/members/fred')->assertOk();
        $this->assertViews('member removed', content: ['fred' => false, 'dave' => true, 'erin' => false], team: ['fred' => false, 'dave' => true, 'erin' => false]);

        // 3. Archive: the Project's collections and folder go for everyone, the Team's asset stays.
        $this->asUser('bob')->postJson('/api/v1/projects/'.$this->project['id'].'/archive')->assertOk();
        $this->assertViews('archived', content: ['bob' => false, 'dave' => false, 'fred' => false, 'erin' => false], team: ['dave' => true, 'fred' => false, 'erin' => false]);

        // 4. Purge (the team admin does it): gone, the Team's asset stays.
        $this->asUser('bob')->deleteJson('/api/v1/projects/'.$this->project['id'])->assertOk();
        $this->assertNull(Project::query()->find($this->project['id']));
        // The folder is in the trash of the team admin who purged it, so only that file node is still readable (bob).
        $this->assertViews('purged', content: ['bob' => $this->purgedFolderStaysInTheTrash(), 'dave' => false, 'fred' => false, 'erin' => false], team: ['dave' => true, 'fred' => false, 'erin' => false]);

        // 5. Delete the Team: nothing of it is left to anyone.
        $this->asUser('alice')->deleteJson('/api/v1/admin/groups/t1')->assertOk();
        $this->assertViews('team deleted', content: ['bob' => $this->purgedFolderStaysInTheTrash(), 'dave' => false, 'fred' => false, 'erin' => false], team: ['bob' => false, 'dave' => false, 'fred' => false, 'erin' => false]);
    }

    /**
     * @param  array<string, bool>  $content
     * @param  array<string, bool>  $team
     */
    /** The Drive folder lands in the purger's Drive trash; no other app keeps anything of the Project. */
    protected function purgedFolderStaysInTheTrash(): bool
    {
        return false;
    }

    private function assertViews(string $step, array $content, array $team): void
    {
        foreach ($content as $user => $expected) {
            $seen = $this->seesProjectContent($user);
            if ($seen !== null) {
                $this->assertSame($expected, $seen, "{$step}: {$user} and the Project's content");
            }
        }
        foreach ($team as $user => $expected) {
            $seen = $this->seesTeamAsset($user);
            if ($seen !== null) {
                $this->assertSame($expected, $seen, "{$step}: {$user} and the Team's asset");
            }
        }
    }

    /** @return list<string> */
    protected function idsOf(string $user, string $path): array
    {
        $response = $this->asUser($user)->getJson($path);

        return $response->status() === 200 ? array_map('strval', array_column((array) $response->json('list'), 'id')) : [];
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $calls
     * @return array<string, mixed>
     */
    protected function jmapCall(string $user, string $capability, array $calls): array
    {
        return (array) $this->asUser($user)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, $capability],
            'methodCalls' => $calls,
        ])->assertOk()->json('methodResponses.0.1');
    }

    protected function resource(string $key): string
    {
        return (string) $this->project['resources'][$key];
    }
}

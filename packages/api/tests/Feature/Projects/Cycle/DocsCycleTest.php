<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Docs.
 */
final class DocsCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_docs(): void
    {
        $this->walkTheCycle();
    }

    protected function seedProjectContent(): void
    {
        app(WgwStorage::class)->files()->put('groups/t1/Launch/plan.md', '# Plan');
        app(FileNodeIndexService::class)->recordCreate('groups/t1/Launch/plan.md');
    }

    protected function seesProjectContent(string $user): ?bool
    {
        $response = $this->asUser($user)->getJson('/api/v1/files/children?path='.urlencode('/groups/t1/Launch'));

        return $response->status() === 200 && str_contains((string) json_encode($response->json()), 'plan.md');
    }

    protected function seesTeamAsset(string $user): ?bool
    {
        return $this->asUser($user)->getJson('/api/v1/files/children?path='.urlencode('/groups/t1'))->status() === 200;
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use App\Services\Jmap\JmapCapabilities;
use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Drive.
 */
final class DriveCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_drive(): void
    {
        $this->walkTheCycle();
    }

    protected function seesProjectContent(string $user): ?bool
    {
        $got = $this->jmapCall($user, JmapCapabilities::FILENODE, [['FileNode/get', ['accountId' => $user, 'ids' => [$this->resource('driveFolderId')]], 'g']]);

        return (array) ($got['list'] ?? []) !== [];
    }

    protected function purgedFolderStaysInTheTrash(): bool
    {
        return true;
    }

    protected function seesTeamAsset(string $user): ?bool
    {
        return $this->asUser($user)->getJson('/api/v1/files/children?path='.urlencode('/groups/t1'))->status() === 200;
    }
}

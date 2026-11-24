<?php

declare(strict_types=1);

namespace Tests\Feature\Projects\Cycle;

use Tests\Support\WgwDatabaseTestCase;

/**
 * #819: the membership cycle of one Team and one Project, seen through Meet.
 */
final class MeetCycleTest extends WgwDatabaseTestCase
{
    use WalksTheMembershipCycle;

    public function test_the_membership_cycle_in_meet(): void
    {
        $this->walkTheCycle();
    }

    protected function seesProjectContent(string $user): ?bool
    {
        return in_array($this->resource('channelId'), $this->idsOf($user, '/api/v1/chat/channels'), true);
    }

    protected function seesTeamAsset(string $user): ?bool
    {
        $response = $this->asUser($user)->getJson('/api/v1/chat/channels');
        $channels = $response->status() === 200 ? (array) $response->json('list') : [];

        foreach ($channels as $channel) {
            if (($channel['isDefault'] ?? false) === true && ($channel['groupSlug'] ?? null) === 't1') {
                return true;
            }
        }

        return false;
    }
}

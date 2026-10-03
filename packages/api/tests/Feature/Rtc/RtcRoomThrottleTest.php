<?php

declare(strict_types=1);

namespace Tests\Feature\Rtc;

use Illuminate\Testing\TestResponse;
use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class RtcRoomThrottleTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
    }

    public function test_two_guests_behind_one_nat_do_not_share_a_budget(): void
    {
        $first = $this->guestJoin('first-peer', 'First');
        $second = $this->guestJoin('second-peer', 'Second');

        // Both actors poll from the same address; the limiter keys on the
        // session, so neither can exhaust the other's allowance.
        for ($request = 0; $request < 80; $request++) {
            $this->pollAs('first-peer', $first['sessionKey'])->assertOk();
        }

        $this->pollAs('second-peer', $second['sessionKey'])->assertOk();
    }

    public function test_a_single_actor_is_cut_off_past_three_hundred_requests_a_minute(): void
    {
        $guest = $this->guestJoin('first-peer', 'First');
        $seen = 0;

        for ($request = 0; $request < 400; $request++) {
            $status = $this->pollAs('first-peer', $guest['sessionKey'])->getStatusCode();
            if ($status === 429) {
                break;
            }
            $seen++;
        }

        $this->assertLessThan(400, $seen, 'The per-actor limiter never engaged.');
        $this->assertGreaterThan(
            250,
            $seen,
            'Normal signaling traffic must fit inside the budget; a 400 ms poll is 150 requests a minute.',
        );
    }

    public function test_anonymous_joins_from_one_address_stop_at_sixty_a_minute(): void
    {
        $accepted = 0;

        for ($attempt = 0; $attempt < 70; $attempt++) {
            $response = $this->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'peer-'.$attempt,
                'name' => 'Guest '.$attempt,
            ]);
            if ($response->getStatusCode() === 429) {
                break;
            }
            $accepted++;
        }

        $this->assertLessThanOrEqual(60, $accepted);
        $this->assertGreaterThan(0, $accepted);
    }

    public function test_an_authenticated_join_is_not_charged_to_the_anonymous_bucket(): void
    {
        $token = $this->userBearerToken();

        for ($attempt = 0; $attempt < 70; $attempt++) {
            $this->withBearer($token)->postJson($this->meetRoomPath('/participants'), [
                'peerId' => 'bob-peer',
                'name' => 'Bob',
            ])->assertOk();
        }
    }

    private function pollAs(string $peerId, string $sessionKey): TestResponse
    {
        return $this->getJson(
            $this->meetRoomPath('/events').'?peerId='.$peerId.'&sessionKey='.$sessionKey,
        );
    }
}

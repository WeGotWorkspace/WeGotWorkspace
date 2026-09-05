<?php

declare(strict_types=1);

namespace Tests\Feature\Meet;

use Tests\Support\MeetTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class MeetBrowserPeerReuseTest extends WgwDatabaseTestCase
{
    use MeetTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpMeetFixtures();
        $this->reserveMeetRoom()->assertCreated();
    }

    public function test_same_browser_rejoin_evicts_the_leftover_peer(): void
    {
        $browser = str_repeat('ab', 16);
        $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-old',
            'name' => 'Alice',
            'browserId' => $browser,
        ])->assertOk();

        $this->asUser('bob')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'bob-peer',
            'name' => 'Bob',
            'browserId' => str_repeat('cd', 16),
        ])->assertOk();

        $rejoin = $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-new',
            'name' => 'Alice',
            'browserId' => $browser,
        ])->assertOk()->json('peers');

        $ids = array_column($rejoin, 'id');
        $this->assertContains('bob-peer', $ids);
        $this->assertNotContains('alice-old', $ids);
    }

    public function test_same_user_on_two_browsers_keeps_both_peers(): void
    {
        $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-laptop',
            'name' => 'Alice',
            'browserId' => str_repeat('11', 16),
        ])->assertOk();

        $phone = $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-phone',
            'name' => 'Alice',
            'browserId' => str_repeat('22', 16),
        ])->assertOk()->json('peers');

        $this->assertContains('alice-laptop', array_column($phone, 'id'));
    }

    public function test_guest_reload_with_new_session_still_evicts_same_browser(): void
    {
        $browser = str_repeat('ef', 16);
        $this->withoutBearer();
        $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-old',
            'name' => 'Guest',
            'browserId' => $browser,
        ])->assertOk();

        $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-peer',
            'name' => 'Alice',
            'browserId' => str_repeat('99', 16),
        ])->assertOk();

        $this->withoutBearer();
        $rejoin = $this->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'guest-new',
            'name' => 'Guest',
            'browserId' => $browser,
        ])->assertOk()->json('peers');

        $ids = array_column($rejoin, 'id');
        $this->assertContains('alice-peer', $ids);
        $this->assertNotContains('guest-old', $ids);
    }

    public function test_join_without_browser_id_does_not_evict(): void
    {
        $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-one',
            'name' => 'Alice',
        ])->assertOk();

        $second = $this->asUser('alice')->postJson($this->meetRoomPath('/participants'), [
            'peerId' => 'alice-two',
            'name' => 'Alice',
        ])->assertOk()->json('peers');

        $this->assertContains('alice-one', array_column($second, 'id'));
    }

    private function asUser(string $username): self
    {
        return $this->withBearer($this->issueBearerTokenFor($username));
    }
}

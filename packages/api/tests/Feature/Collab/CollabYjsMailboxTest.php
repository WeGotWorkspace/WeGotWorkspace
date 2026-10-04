<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use Illuminate\Support\Carbon;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Contract C4 on the collab mailbox: fan-out, the reader ban, the size cap,
 * and the per-peer send rate.
 */
final class CollabYjsMailboxTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const DOC_PATH = '/users/bob/workspace/plan.md';

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($this->userBearerToken(), '/users/bob/workspace', 'plan.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_a_targeted_update_is_delivered_to_that_peer(): void
    {
        [$bob, $carol] = $this->twoWriters();

        $this->send($this->userBearerToken(), $bob, $carol, 'yjs', $this->payload(1))
            ->assertOk();

        $messages = $this->poll($this->carolBearerToken(), $carol);
        $this->assertCount(1, $messages);
        $this->assertSame('yjs', $messages[0]['type']);
        $this->assertSame($bob, $messages[0]['from']);
        $this->assertSame('AQID', $messages[0]['payload']['u']);
        $this->assertSame(1, $messages[0]['payload']['n']);
    }

    public function test_star_fans_out_one_row_per_other_peer(): void
    {
        $this->seedWgwUser('dave', displayName: 'Dave');
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => 'edit',
            'shareWith' => [
                'carol' => ['access' => 'edit'],
                'dave' => ['access' => 'edit'],
            ],
        ])->assertOk();
        $bob = $this->join($this->userBearerToken(), 'Bob');
        $carol = $this->join($this->carolBearerToken(), 'Carol');
        $daveToken = $this->issueBearerTokenFor('dave');
        $dave = $this->join($daveToken, 'Dave');

        $this->send($this->userBearerToken(), $bob, '*', 'yjs', $this->payload(4))->assertOk();

        $this->assertSame('yjs', $this->poll($this->carolBearerToken(), $carol)[0]['type']);
        $this->assertSame('yjs', $this->poll($daveToken, $dave)[0]['type']);
        $this->assertSame([], $this->poll($this->userBearerToken(), $bob));
    }

    public function test_a_reader_cannot_publish_an_update(): void
    {
        $this->share('view');
        $carol = $this->join($this->carolBearerToken(), 'Carol');
        $bob = $this->join($this->userBearerToken(), 'Bob');

        $this->send($this->carolBearerToken(), $carol, $bob, 'yjs', $this->payload(1))
            ->assertStatus(403)
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_a_reader_may_ask_for_a_state_vector_diff(): void
    {
        $this->share('view');
        $carol = $this->join($this->carolBearerToken(), 'Carol');
        $bob = $this->join($this->userBearerToken(), 'Bob');

        $this->send($this->carolBearerToken(), $carol, $bob, 'yjs-sv', $this->payload(2))
            ->assertOk();

        $this->assertSame('yjs-sv', $this->poll($this->userBearerToken(), $bob)[0]['type']);
    }

    public function test_a_state_vector_cannot_fan_out(): void
    {
        $bob = $this->join($this->userBearerToken(), 'Bob');

        $this->send($this->userBearerToken(), $bob, '*', 'yjs-sv', $this->payload(1))
            ->assertStatus(400)
            ->assertJson(['error' => 'invalid_peer']);
    }

    public function test_an_encoded_payload_over_64_kib_is_rejected(): void
    {
        $bob = $this->join($this->userBearerToken(), 'Bob');
        $carol = $this->join($this->carolBearerToken(), 'Carol', 'edit');

        $this->send($this->userBearerToken(), $bob, $carol, 'yjs', [
            'u' => str_repeat('A', 70_000),
            'n' => 1,
        ])->assertStatus(413)->assertJson(['error' => 'payload_too_large']);
    }

    public function test_the_eleventh_send_in_a_second_is_rate_limited(): void
    {
        [$bob, $carol] = $this->twoWriters();
        // Eleven HTTP round trips outlast a one-second window. Freeze the clock
        // so the limiter still sees them as the same second.
        Carbon::setTestNow(Carbon::parse('2026-01-01 00:00:00'));

        try {
            for ($seq = 1; $seq <= 10; $seq++) {
                $this->send($this->userBearerToken(), $bob, $carol, 'yjs', $this->payload($seq))
                    ->assertOk();
            }

            $this->send($this->userBearerToken(), $bob, $carol, 'yjs', $this->payload(11))
                ->assertStatus(429)
                ->assertJson(['error' => 'rate_limited']);
        } finally {
            Carbon::setTestNow();
        }
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function twoWriters(): array
    {
        $this->share('edit');

        return [
            $this->join($this->userBearerToken(), 'Bob'),
            $this->join($this->carolBearerToken(), 'Carol'),
        ];
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId(self::DOC_PATH);
    }

    private function join(string $token, string $name, ?string $access = null): string
    {
        if ($access !== null) {
            $this->share($access);
        }

        return (string) $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', ['name' => $name])
            ->assertOk()
            ->json('peerId');
    }

    /**
     * @param  array{u: string, n: int}  $payload
     */
    private function send(string $token, string $from, string $to, string $type, array $payload): TestResponse
    {
        return $this->withBearer($token)->postJson('/api/v1/rooms/'.$this->roomId().'/events', [
            'peerId' => $from,
            'to' => $to,
            'type' => $type,
            'payload' => $payload,
        ]);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function poll(string $token, string $peerId): array
    {
        $messages = $this->withBearer($token)
            ->getJson('/api/v1/rooms/'.$this->roomId().'/events?peerId='.$peerId.'&since=0')
            ->assertOk()
            ->json('messages');
        $this->assertIsArray($messages);

        return $messages;
    }

    private function share(string $access): void
    {
        $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => $access,
            'shareWith' => ['carol' => ['access' => $access]],
        ])->assertOk();
    }

    /**
     * @return array{u: string, n: int}
     */
    private function payload(int $seq): array
    {
        return ['u' => 'AQID', 'n' => $seq];
    }
}

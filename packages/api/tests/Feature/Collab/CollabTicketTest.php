<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\AppSetting;
use App\Models\CollabPeer;
use App\Services\Collab\CollabRoomPolicy;
use App\Services\Collab\CollabTicketCodec;
use App\Services\Collab\CollabTicketKeyring;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Testing\TestResponse;
use Tests\Support\DriveTestFixtures;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Contract C2: a collab peer leaves join with a signed ticket that names the
 * room, the account and the access the server resolved. Peers verify it before
 * they accept a reused principal data channel, so nothing in the ticket may be
 * client-claimed and the signing key may never leave the server.
 */
final class CollabTicketTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const DOC_PATH = '/users/bob/workspace/plan.md';

    private string $shareId = '';

    private string $shareUpdatedAt = '';

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

    public function test_join_returns_a_ticket_bound_to_the_room_account_peer_and_access(): void
    {
        $this->share('comment');

        $joined = $this->join($this->carolBearerToken(), 'Carol')->assertOk();
        $payload = CollabTicketCodec::decodePayload((string) $joined->json('ticket'));

        $this->assertNotNull($payload);
        $this->assertSame(1, $payload['v']);
        $this->assertSame(app(CollabRoomPolicy::class)->roomKey(ltrim(self::DOC_PATH, '/')), $payload['room']);
        $this->assertSame('carol', $payload['user']);
        $this->assertSame($joined->json('peerId'), $payload['peer']);
        $this->assertSame('comment', $payload['access']);
    }

    public function test_the_ticket_access_is_the_resolved_right_and_not_a_claim_from_the_client(): void
    {
        $this->share('view');

        $joined = $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', [
                'name' => 'Carol',
                'access' => 'write',
            ])
            ->assertOk();

        $payload = CollabTicketCodec::decodePayload((string) $joined->json('ticket'));
        $this->assertNotNull($payload);
        $this->assertSame('read', $payload['access']);
    }

    public function test_the_signature_is_sixty_four_p1363_bytes_the_published_jwk_verifies(): void
    {
        $ticket = (string) $this->join($this->userBearerToken(), 'Bob')->assertOk()->json('ticket');
        [$encodedPayload, $encodedSignature] = explode('.', $ticket);
        $signature = CollabTicketCodec::base64UrlDecode($encodedSignature);

        $this->assertSame(64, strlen($signature));
        $this->assertSame(
            1,
            openssl_verify(
                $encodedPayload,
                CollabTicketCodec::p1363ToDer($signature),
                $this->publicKeyFromJwk($this->publishedJwk()),
                OPENSSL_ALGO_SHA256,
            ),
        );
    }

    public function test_a_ticket_signed_by_a_rotated_key_no_longer_verifies_under_the_old_jwk(): void
    {
        $this->join($this->userBearerToken(), 'Bob')->assertOk();
        $staleJwk = $this->publishedJwk();

        app(CollabTicketKeyring::class)->rotate();
        $ticket = (string) $this->join($this->userBearerToken(), 'Bob')->assertOk()->json('ticket');
        [$encodedPayload, $encodedSignature] = explode('.', $ticket);

        $this->assertNotSame($staleJwk['kid'], $this->publishedJwk()['kid']);
        $this->assertSame(
            0,
            openssl_verify(
                $encodedPayload,
                CollabTicketCodec::p1363ToDer(CollabTicketCodec::base64UrlDecode($encodedSignature)),
                $this->publicKeyFromJwk($staleJwk),
                OPENSSL_ALGO_SHA256,
            ),
        );
    }

    public function test_the_room_configuration_publishes_the_public_jwk_with_its_kid(): void
    {
        $jwk = $this->publishedJwk();

        $this->assertSame('EC', $jwk['kty']);
        $this->assertSame('P-256', $jwk['crv']);
        $this->assertSame('ES256', $jwk['alg']);
        $this->assertSame(32, strlen(CollabTicketCodec::base64UrlDecode($jwk['x'])));
        $this->assertSame(32, strlen(CollabTicketCodec::base64UrlDecode($jwk['y'])));
        $this->assertNotSame('', $jwk['kid']);
        $this->assertArrayNotHasKey('d', $jwk);
    }

    public function test_the_room_configuration_stays_closed_to_an_actor_without_document_access(): void
    {
        $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/rooms/'.$this->roomId().'/configuration')
            ->assertStatus(403);
    }

    public function test_the_signing_key_is_encrypted_at_rest_and_never_served(): void
    {
        $response = $this->join($this->userBearerToken(), 'Bob')->assertOk();

        $stored = (string) AppSetting::getValue(CollabTicketKeyring::PRIVATE_PEM_SETTING, '');
        $this->assertNotSame('', $stored);
        $this->assertStringNotContainsString('BEGIN', $stored);
        $this->assertStringContainsString('BEGIN', Crypt::decryptString($stored));
        $this->assertStringNotContainsString('BEGIN', $response->getContent() ?: '');
        $this->assertStringNotContainsString('PRIVATE', json_encode($this->publishedJwk()) ?: '');
    }

    public function test_a_poll_hands_the_peer_a_ticket_carrying_the_recomputed_access(): void
    {
        $this->share('edit');
        $peerId = (string) $this->join($this->carolBearerToken(), 'Carol')->assertOk()->json('peerId');

        $this->downgradeShareTo('view');

        $payload = CollabTicketCodec::decodePayload((string) $this->poll($peerId)->assertOk()->json('ticket'));
        $this->assertNotNull($payload);
        $this->assertSame('read', $payload['access']);
        $this->assertSame('read', $this->storedAccessFor('carol'));
    }

    public function test_a_revoked_share_ends_live_access_on_the_next_poll(): void
    {
        $this->share('edit');
        $peerId = (string) $this->join($this->carolBearerToken(), 'Carol')->assertOk()->json('peerId');
        $this->poll($peerId)->assertOk();

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk();

        $this->poll($peerId)
            ->assertStatus(403)
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_a_revoked_share_also_closes_the_send_mailbox(): void
    {
        $this->share('edit');
        $carolPeer = (string) $this->join($this->carolBearerToken(), 'Carol')->assertOk()->json('peerId');
        $bobPeer = (string) $this->join($this->userBearerToken(), 'Bob')->assertOk()->json('peerId');

        $this->withBearer($this->userBearerToken())
            ->deleteJson('/api/v1/files/shares/'.$this->shareId)
            ->assertOk();

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/rooms/'.$this->roomId().'/events', [
                'peerId' => $carolPeer,
                'to' => $bobPeer,
                'type' => 'offer',
                'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
            ])
            ->assertStatus(403)
            ->assertJson(['error' => 'forbidden']);
    }

    public function test_the_ticket_is_not_part_of_the_roster_a_peer_sees(): void
    {
        $this->share('edit');
        $this->join($this->carolBearerToken(), 'Carol')->assertOk();

        $peers = $this->join($this->userBearerToken(), 'Bob')->assertOk()->json('peers');

        foreach ((array) $peers as $peer) {
            $this->assertArrayNotHasKey('ticket', (array) $peer);
        }
    }

    private function roomId(): string
    {
        return RoomTestHelper::fileRoomId(self::DOC_PATH);
    }

    private function join(string $token, string $name): TestResponse
    {
        return $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$this->roomId().'/participants', ['name' => $name]);
    }

    private function poll(string $peerId): TestResponse
    {
        return $this->withBearer($this->carolBearerToken())
            ->getJson('/api/v1/rooms/'.$this->roomId().'/events?peerId='.$peerId);
    }

    private function share(string $access): void
    {
        $created = $this->withBearer($this->userBearerToken())->postJson('/api/v1/files/shares', [
            'path' => self::DOC_PATH,
            'kind' => 'member',
            'defaultAccess' => $access,
            'shareWith' => ['carol' => ['access' => $access]],
        ]);
        $created->assertOk();
        $this->shareId = (string) $created->json('data.id');
        $this->shareUpdatedAt = (string) $created->json('data.updatedAt');
    }

    private function downgradeShareTo(string $access): void
    {
        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/files/shares/'.$this->shareId, [
                'updatedAt' => $this->shareUpdatedAt,
                'shareWith' => ['carol' => ['access' => $access]],
            ])
            ->assertOk();
    }

    /**
     * @return array<string, string>
     */
    private function publishedJwk(): array
    {
        /** @var array<string, string> $jwk */
        $jwk = (array) $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/rooms/'.$this->roomId().'/configuration')
            ->assertOk()
            ->json('collabTicket.jwk');

        return $jwk;
    }

    /**
     * Rebuild an SPKI public key from the published coordinates — exactly the
     * material `crypto.subtle.importKey('jwk', …)` gets in the browser.
     *
     * @param  array<string, string>  $jwk
     */
    private function publicKeyFromJwk(array $jwk): \OpenSSLAsymmetricKey
    {
        $spki = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200')
            ."\x04"
            .CollabTicketCodec::base64UrlDecode($jwk['x'])
            .CollabTicketCodec::base64UrlDecode($jwk['y']);
        $pem = "-----BEGIN PUBLIC KEY-----\n"
            .chunk_split(base64_encode($spki), 64, "\n")
            ."-----END PUBLIC KEY-----\n";
        $key = openssl_pkey_get_public($pem);
        $this->assertInstanceOf(\OpenSSLAsymmetricKey::class, $key);

        return $key;
    }

    private function storedAccessFor(string $username): string
    {
        return (string) CollabPeer::query()
            ->where('owner_user', 'u:'.$username)
            ->value('access');
    }
}

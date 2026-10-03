<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\CollabMessage;
use App\Models\CollabPeer;
use App\Models\DriveShare;
use App\Models\DriveShareGrant;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\RoomTestHelper;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * Docs paths that are not plain ASCII identifiers: accents, parentheses, `&`,
 * and a 250-character path all open, save, and collaborate (issue #1087).
 */
final class CollabPathEncodingTest extends WgwDatabaseTestCase
{
    private const PARENTHESES = '/users/alice/docs/Offerte (v2).md';

    private const ACCENTS = '/users/alice/docs/Café notities.md';

    private const AMPERSAND = '/users/alice/Klanten & partners/plan.md';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-collab-path-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/docs');
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/Klanten & partners');
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    /**
     * @return array<string, array{string}>
     */
    public static function documentPathProvider(): array
    {
        return [
            'parentheses' => [self::PARENTHESES],
            'accents' => [self::ACCENTS],
            'ampersand in a directory' => [self::AMPERSAND],
            '250 characters' => [self::longPath()],
        ];
    }

    #[DataProvider('documentPathProvider')]
    public function test_document_opens_and_saves(string $path): void
    {
        $token = $this->issueBearerToken();
        $url = '/api/v1/files/collaboration?path='.urlencode($path);

        $this->withBearer($token)
            ->get($url)
            ->assertOk()
            ->assertHeader('Content-Type', 'text/markdown; charset=utf-8');

        $this->withBearer($token)
            ->putJson($url, [
                'markdown' => "# Café & co (v2)\n",
                'yjs' => [1, 2, 3, 255],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $storage = app(WgwStorage::class)->files();
        $this->assertSame("# Café & co (v2)\n", $storage->get(ltrim($path, '/')));

        $this->withBearer($token)
            ->get($url)
            ->assertOk()
            ->assertSeeText('# Café & co (v2)');

        $this->withBearer($token)
            ->get($url.'&format=yjs')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertContent("\x01\x02\x03\xff");
    }

    #[DataProvider('documentPathProvider')]
    public function test_live_collaboration_roster_and_signaling_work(string $path): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->grantEditShareToBob($path);

        $roomId = RoomTestHelper::fileRoomId($path);
        $aliceToken = $this->issueBearerTokenFor('alice');
        $bobToken = $this->issueBearerTokenFor('bob');

        $aliceJoin = $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Alice']);
        $aliceJoin->assertOk();
        $alicePeerId = (string) $aliceJoin->json('peerId');

        $bobJoin = $this->withBearer($bobToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Bob']);
        $bobJoin->assertOk();
        $bobPeerId = (string) $bobJoin->json('peerId');
        $bobJoin->assertJsonPath('peers.0.id', $alicePeerId);

        $this->withBearer($aliceToken)
            ->postJson('/api/v1/rooms/'.$roomId.'/events', [
                'peerId' => $alicePeerId,
                'to' => $bobPeerId,
                'type' => 'offer',
                'payload' => ['type' => 'offer', 'sdp' => 'v=0'],
            ])
            ->assertOk()
            ->assertJson(['ok' => true]);

        $poll = $this->withBearer($bobToken)
            ->getJson('/api/v1/rooms/'.$roomId.'/events?peerId='.$bobPeerId.'&since=0');
        $poll->assertOk();
        $poll->assertJsonPath('peers.0.id', $alicePeerId);
        $poll->assertJsonPath('messages.0.type', 'offer');
        $poll->assertJsonPath('messages.0.from', $alicePeerId);

        $this->withBearer($bobToken)
            ->deleteJson('/api/v1/rooms/'.$roomId.'/participants/'.$bobPeerId)
            ->assertOk()
            ->assertJson(['ok' => true]);
    }

    #[DataProvider('documentPathProvider')]
    public function test_signaling_rows_store_the_sha1_room_key_not_the_path(string $path): void
    {
        $roomId = RoomTestHelper::fileRoomId($path);
        $canonical = ltrim($path, '/');
        $token = $this->issueBearerTokenFor('alice');

        $peerId = (string) $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Alice'])
            ->assertOk()
            ->json('peerId');

        $storedRooms = CollabPeer::query()->pluck('room')->all();
        $this->assertSame([sha1($canonical)], $storedRooms);
        $this->assertMatchesRegularExpression('/^[a-f0-9]{40}$/', (string) $storedRooms[0]);
        $this->assertNotContains($canonical, $storedRooms);

        $this->withBearer($token)
            ->postJson('/api/v1/rooms/'.$roomId.'/events', [
                'peerId' => $peerId,
                'to' => $peerId,
                'type' => 'ice',
                'payload' => ['candidate' => 'a'],
            ])
            ->assertOk();

        $this->assertSame([sha1($canonical)], CollabMessage::query()->pluck('room')->all());
    }

    public function test_leading_slash_variants_share_one_roster_for_a_path_with_accents(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');
        $this->grantEditShareToBob(self::ACCENTS);

        $legacySlashed = 'f_'.rtrim(strtr(base64_encode(self::ACCENTS), '+/', '-_'), '=');
        $canonical = RoomTestHelper::fileRoomId(ltrim(self::ACCENTS, '/'));
        $this->assertNotSame($legacySlashed, $canonical);

        $alicePeerId = (string) $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/rooms/'.$legacySlashed.'/participants', ['name' => 'Alice'])
            ->assertOk()
            ->json('peerId');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/rooms/'.$canonical.'/participants', ['name' => 'Bob'])
            ->assertOk()
            ->assertJsonPath('peers.0.id', $alicePeerId);
    }

    public function test_authorization_runs_on_the_canonical_path_not_the_room_key(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->postJson('/api/v1/rooms/'.RoomTestHelper::fileRoomId(self::ACCENTS).'/participants', [
                'name' => 'Bob',
            ])
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ACCENTS), [
                'markdown' => 'nope',
            ])
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');

        $this->assertSame([], CollabPeer::query()->pluck('room')->all());
    }

    public function test_parent_directory_segment_is_rejected(): void
    {
        $roomId = RoomTestHelper::fileRoomId('/users/alice/docs/../../bob/secret.md');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->postJson('/api/v1/rooms/'.$roomId.'/participants', ['name' => 'Alice'])
            ->assertBadRequest()
            ->assertJsonPath('error', 'invalid_room');

        $this->withBearer($this->issueBearerTokenFor('alice'))
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/alice/docs/../../bob/secret.md'))
            ->assertBadRequest()
            ->assertJsonPath('error', 'invalid_room');
    }

    private static function longPath(): string
    {
        $prefix = '/users/alice/docs/';
        $suffix = '.md';
        // 250 characters once the leading slash is stripped to the canonical room.
        $filler = 250 - (mb_strlen($prefix) - 1) - mb_strlen($suffix);

        return $prefix.str_repeat('a', $filler).$suffix;
    }

    private function grantEditShareToBob(string $path): void
    {
        $share = new DriveShare;
        $share->id = (string) Str::uuid();
        $share->path = $path;
        $share->owner_username = 'alice';
        $share->kind = 'member';
        $share->default_access = 'edit';
        $share->save();

        $grant = new DriveShareGrant;
        $grant->id = (string) Str::uuid();
        $grant->share_id = $share->id;
        $grant->grantee_type = 'user';
        $grant->grantee_user = 'bob';
        $grant->access = 'edit';
        $grant->status = 'active';
        $grant->save();
    }
}

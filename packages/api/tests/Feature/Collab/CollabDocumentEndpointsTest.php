<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class CollabDocumentEndpointsTest extends WgwDatabaseTestCase
{
    private const ROOM = '/users/alice/docs/together.md';

    private const ROOM_WITH_SPACES = '/users/alice/docs/Hello World.md';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-collab-doc-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice/docs');
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

    public function test_get_document_requires_auth(): void
    {
        $this->getJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM))
            ->assertUnauthorized();
    }

    public function test_markdown_and_yjs_sidecar_round_trip(): void
    {
        $token = $this->issueBearerToken();

        $freshDocument = $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::ROOM))
            ->assertOk()
            ->assertHeader('Content-Type', 'text/markdown; charset=utf-8');
        $this->assertSame('', $freshDocument->getContent());

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::ROOM).'&format=yjs')
            ->assertNoContent();

        $yjsBytes = [1, 2, 3, 255];
        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => "# Together\n\nHello collab.\n",
                'yjs' => $yjsBytes,
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $storage = app(WgwStorage::class)->files();
        $storedMarkdown = (string) $storage->get('users/alice/docs/together.md');
        $this->assertStringContainsString('# Together', $storedMarkdown);
        $this->assertStringContainsString('Hello collab.', $storedMarkdown);
        $this->assertSame(
            "\x01\x02\x03\xff",
            $storage->get('users/alice/docs/.together.md.yjs')
        );

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::ROOM))
            ->assertOk()
            ->assertSeeText('Hello collab.');

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::ROOM).'&format=yjs')
            ->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertContent("\x01\x02\x03\xff");
    }

    public function test_markdown_save_indexes_current_size_without_rename(): void
    {
        $token = $this->issueBearerToken();
        $markdown = "# Together\n\nHello collab indexing.\n";

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => $markdown,
                'yjs' => [1, 2, 3, 255],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $response = $this->withBearer($token)
            ->getJson('/api/v1/search/results?'.http_build_query([
                'q' => 'collab',
                'limit' => 20,
            ]));

        $response->assertOk();
        $results = $response->json('data.results');
        $this->assertIsArray($results);

        $match = null;
        foreach ($results as $row) {
            if (($row['sourceKey'] ?? null) === 'users/alice/docs/together.md') {
                $match = $row;
                break;
            }
        }

        $this->assertNotNull($match, 'Expected the saved document to be indexed.');
        $storedSize = (int) (app(WgwStorage::class)->files()->size('users/alice/docs/together.md') ?? 0);
        $this->assertGreaterThan(0, $storedSize);
        $this->assertSame($storedSize, (int) ($match['size'] ?? 0));
    }

    public function test_markdown_save_updates_the_file_node_index(): void
    {
        $token = $this->issueBearerToken();
        $key = 'users/alice/docs/together.md';
        $index = app(FileNodeIndexService::class);

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => "# Together\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        if ($index->liveByKey($key) === null) {
            $this->assertNotNull($index->recordCreate($key));
        }

        $seq = $index->currentSeq();
        $markdown = "# Together\n\nHello collab indexing.\n";

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => $markdown,
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $row = $index->liveByKey($key);
        $this->assertNotNull($row);
        $storedSize = (int) (app(WgwStorage::class)->files()->size($key) ?? 0);
        $this->assertGreaterThan(0, $storedSize);
        $this->assertSame($storedSize, (int) $row->size_bytes);
        $this->assertSame(hash('sha256', $markdown), $row->content_sha256);
        $this->assertGreaterThan($seq, (int) $row->change_seq);
    }

    public function test_a_yjs_only_save_does_not_touch_the_file_node_index(): void
    {
        $token = $this->issueBearerToken();
        $key = 'users/alice/docs/together.md';
        $index = app(FileNodeIndexService::class);

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => "# Together\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        if ($index->liveByKey($key) === null) {
            $this->assertNotNull($index->recordCreate($key));
        }

        $before = $index->liveByKey($key);
        $this->assertNotNull($before);
        $changeSeq = (int) $before->change_seq;

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'yjs' => [1, 2, 3, 255],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $after = $index->liveByKey($key);
        $this->assertNotNull($after);
        $this->assertSame($changeSeq, (int) $after->change_seq);
    }

    public function test_other_user_cannot_write_alice_document(): void
    {
        $this->seedWgwUser('bob', displayName: 'Bob');

        $this->withBearer($this->issueBearerTokenFor('bob'))
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM), [
                'markdown' => 'nope',
            ])
            ->assertForbidden()
            ->assertJsonPath('error', 'forbidden');
    }

    public function test_document_room_with_spaces_is_supported(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode(self::ROOM_WITH_SPACES), [
                'markdown' => "# Hello World\n",
                'yjs' => [0, 0],
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode(self::ROOM_WITH_SPACES))
            ->assertOk()
            ->assertHeader('Content-Type', 'text/markdown; charset=utf-8')
            ->assertSeeText('# Hello World');
    }

    public function test_my_drive_markdown_collaboration_round_trips(): void
    {
        $token = $this->issueBearerToken();
        $path = '/users/alice/docs/personal.md';

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => "# Personal\n\nMy Drive note.\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk()
            ->assertSeeText('My Drive note.');
    }

    public function test_yaml_collaboration_path_is_allowed(): void
    {
        $token = $this->issueBearerToken();
        $path = '/users/alice/docs/config.yaml';

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => "version: 1\nfeature: docs\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $storage = app(WgwStorage::class)->files();
        $stored = (string) $storage->get('users/alice/docs/config.yaml');
        $this->assertStringContainsString('version: 1', $stored);
        $this->assertStringContainsString('feature: docs', $stored);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk()
            ->assertSeeText('feature: docs');
    }

    public function test_csv_collaboration_path_is_allowed(): void
    {
        $token = $this->issueBearerToken();
        $path = '/users/alice/docs/metrics.csv';

        $this->withBearer($token)
            ->putJson('/api/v1/files/collaboration?path='.urlencode($path), [
                'markdown' => "name,value\nalpha,1\n",
            ])
            ->assertOk()
            ->assertJsonPath('ok', true);

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode($path))
            ->assertOk()
            ->assertSeeText('alpha,1');
    }

    public function test_binary_extension_is_rejected_for_collaboration(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->get('/api/v1/files/collaboration?path='.urlencode('/users/alice/docs/photo.png'))
            ->assertBadRequest()
            ->assertJsonPath('error', 'invalid_document_path');
    }
}

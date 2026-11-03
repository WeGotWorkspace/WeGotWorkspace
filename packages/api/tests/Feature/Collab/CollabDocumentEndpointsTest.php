<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Services\Collab\FramedPayload;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class CollabDocumentEndpointsTest extends WgwDatabaseTestCase
{
    use SendsFramedCollaboration;

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

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::ROOM),
                "# Together\n\nHello collab.\n",
                "\x01\x02\x03\xff",
            )
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

    public function test_framed_collab_body_matches_the_golden_header(): void
    {
        $header = '{"documentLen":4,"yjsLen":4}';
        $this->assertSame(
            pack('n', strlen($header)).$header.'abcdefgh',
            self::framedCollabBody('abcd', 'efgh'),
        );
    }

    /**
     * @return iterable<string, array{0: ?string, 1: ?string, 2: string}>
     */
    public static function framedSaveProvider(): iterable
    {
        $everyByte = '';
        for ($byte = 0; $byte <= 255; $byte++) {
            $everyByte .= chr($byte);
        }

        yield 'markdown only' => ["# Only markdown\n", null, 'markdown-only.md'];
        yield 'yjs only' => [null, "\x01\x02", 'yjs-only.md'];
        yield 'nothing to save' => [null, null, 'nothing.md'];
        yield 'empty sidecar' => ["# Kept\n", '', 'empty-sidecar.md'];
        yield 'every byte' => ["# Bytes\n", $everyByte, 'every-byte.md'];
        yield 'invalid utf-8' => ["\x80\xbf\xff\xc3\x28", "\x01", 'invalid-utf8.md'];
        yield 'csv quotes' => ["\"a\",\"b\"\n\"c\",\"d\"\n", "\x02", 'quotes.csv'];
    }

    #[DataProvider('framedSaveProvider')]
    public function test_framed_save_cases(?string $markdown, ?string $yjs, string $name): void
    {
        $token = $this->issueBearerToken();
        $path = '/users/alice/docs/'.$name;
        $url = '/api/v1/files/collaboration?path='.urlencode($path);
        $storage = app(WgwStorage::class)->files();
        $documentKey = 'users/alice/docs/'.$name;
        $sidecarKey = 'users/alice/docs/.'.$name.'.yjs';

        $response = $this->withBearer($token)->putCollaboration($url, $markdown, $yjs);

        if ($markdown === null && $yjs === null) {
            $response->assertStatus(400)->assertJsonPath('error', 'nothing_to_save');
            $this->assertFalse($storage->fileExists($documentKey));
            $this->assertFalse($storage->fileExists($sidecarKey));

            return;
        }

        $response->assertOk();
        if ($markdown === null) {
            $this->assertFalse($storage->fileExists($documentKey));
        } else {
            $this->assertSame($markdown, (string) $storage->get($documentKey));
        }
        if ($yjs === null) {
            $this->assertFalse($storage->fileExists($sidecarKey));
        } else {
            $this->assertTrue($storage->fileExists($sidecarKey));
            $this->assertSame($yjs, (string) $storage->get($sidecarKey));
        }
    }

    public function test_markdown_save_indexes_current_size_without_rename(): void
    {
        $token = $this->issueBearerToken();
        $markdown = "# Together\n\nHello collab indexing.\n";

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::ROOM),
                $markdown,
                "\x01\x02\x03\xff",
            )
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode(self::ROOM), "# Together\n")
            ->assertOk()
            ->assertJsonPath('ok', true);

        if ($index->liveByKey($key) === null) {
            $this->assertNotNull($index->recordCreate($key));
        }

        $seq = $index->currentSeq();
        $markdown = "# Together\n\nHello collab indexing.";

        $this->withBearer($token)
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode(self::ROOM), $markdown)
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode(self::ROOM), "# Together\n")
            ->assertOk()
            ->assertJsonPath('ok', true);

        if ($index->liveByKey($key) === null) {
            $this->assertNotNull($index->recordCreate($key));
        }

        $before = $index->liveByKey($key);
        $this->assertNotNull($before);
        $changeSeq = (int) $before->change_seq;

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::ROOM),
                null,
                "\x01\x02\x03\xff",
            )
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode(self::ROOM), 'nope')
            ->assertNotFound()
            ->assertJsonPath('error', 'not_found');
    }

    public function test_document_room_with_spaces_is_supported(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::ROOM_WITH_SPACES),
                "# Hello World\n",
                "\x00\x00",
            )
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode($path), "# Personal\n\nMy Drive note.\n")
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode($path), "version: 1\nfeature: docs\n")
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
            ->putCollaboration('/api/v1/files/collaboration?path='.urlencode($path), "name,value\nalpha,1\n")
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

    public function test_a_frame_that_does_not_parse_is_invalid_body(): void
    {
        $token = $this->issueBearerToken();
        $url = '/api/v1/files/collaboration?path='.urlencode(self::ROOM);

        $this->withBearer($token)
            ->putCollaborationRaw($url, pack('n', 40).'short')
            ->assertStatus(400)
            ->assertJsonPath('error', FramedPayload::INVALID_BODY_MESSAGE)
            ->assertJsonPath('code', 'invalid_body');

        $json = '{"documentLen":1,"yjsLen":1}';
        $this->withBearer($token)
            ->putCollaborationRaw($url, pack('n', strlen($json)).$json.'x')
            ->assertStatus(400)
            ->assertJsonPath('error', FramedPayload::INVALID_BODY_MESSAGE)
            ->assertJsonPath('code', 'invalid_body');

        $notJson = 'not-json';
        $this->withBearer($token)
            ->putCollaborationRaw($url, pack('n', strlen($notJson)).$notJson)
            ->assertStatus(400)
            ->assertJsonPath('error', FramedPayload::INVALID_BODY_MESSAGE)
            ->assertJsonPath('code', 'invalid_body');

        $array = '[1,2]';
        $this->withBearer($token)
            ->putCollaborationRaw($url, pack('n', strlen($array)).$array)
            ->assertStatus(400)
            ->assertJsonPath('error', FramedPayload::INVALID_BODY_MESSAGE)
            ->assertJsonPath('code', 'invalid_body');
    }

    public function test_yjs_at_the_cap_lands_and_one_byte_over_is_rejected(): void
    {
        $token = $this->issueBearerToken();
        $url = '/api/v1/files/collaboration?path='.urlencode(self::ROOM);
        $atCap = str_repeat("\xab", 5_242_880);

        $this->withBearer($token)
            ->putCollaboration($url, '# cap', $atCap)
            ->assertOk();
        $this->assertSame(
            $atCap,
            app(WgwStorage::class)->files()->get('users/alice/docs/.together.md.yjs'),
        );

        $this->withBearer($token)
            ->putCollaboration($url, '# over', $atCap."\x00")
            ->assertStatus(413)
            ->assertJsonPath('error', 'yjs_too_large');
    }

    public function test_a_large_yjs_update_round_trips_through_the_endpoint(): void
    {
        $token = $this->issueBearerToken();
        $url = '/api/v1/files/collaboration?path='.urlencode(self::ROOM);
        $yjs = dirname(base_path(), 2).'/packages/apps/node_modules/yjs/dist/yjs.mjs';
        $this->assertFileExists($yjs);
        $script = <<<'JS'
import * as Y from process.env.YJS_MODULE;
const doc = new Y.Doc();
doc.clientID = 1;
const rows = doc.getMap("rows");
for (let row = 0; row < 2000; row += 1) {
  const cells = new Y.Map();
  for (let col = 0; col < 9; col += 1) {
    cells.set(String(col), `row ${row} col ${col} "quoted"`);
  }
  rows.set(String(row), cells);
}
process.stdout.write(Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64"));
JS;
        $script = str_replace('process.env.YJS_MODULE', json_encode($yjs), $script);
        $encoded = shell_exec('node --input-type=module -e '.escapeshellarg($script));
        $this->assertIsString($encoded);
        $update = base64_decode($encoded, true);
        $this->assertIsString($update);
        $this->assertGreaterThan(450_000, strlen($update));

        $this->withBearer($token)
            ->putCollaboration($url, "# Sheet\n", $update)
            ->assertOk();

        $fetched = $this->withBearer($token)
            ->get($url.'&format=yjs')
            ->assertOk()
            ->getContent();
        $this->assertSame($update, $fetched);

        $dir = sys_get_temp_dir().'/wgw-yjs-roundtrip-'.uniqid('', true);
        mkdir($dir);
        file_put_contents($dir.'/a.bin', $update);
        file_put_contents($dir.'/b.bin', $fetched);
        $compare = <<<'JS'
import { readFileSync } from "node:fs";
import * as Y from process.env.YJS_MODULE;
const saved = new Y.Doc();
const loaded = new Y.Doc();
Y.applyUpdate(saved, readFileSync(process.env.LEFT));
Y.applyUpdate(loaded, readFileSync(process.env.RIGHT));
const a = Buffer.from(Y.encodeStateAsUpdate(saved));
const b = Buffer.from(Y.encodeStateAsUpdate(loaded));
if (!a.equals(b)) process.exit(1);
JS;
        $compare = str_replace('process.env.YJS_MODULE', json_encode($yjs), $compare);
        $left = escapeshellarg($dir.'/a.bin');
        $right = escapeshellarg($dir.'/b.bin');
        exec(
            'LEFT='.$left.' RIGHT='.$right.' node --input-type=module -e '.escapeshellarg($compare),
            $output,
            $status,
        );
        $this->assertSame(0, $status, implode("\n", $output));
    }
}

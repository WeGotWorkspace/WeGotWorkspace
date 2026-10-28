<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DocYjsState;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Jmap\FileNodes\FileNodeAccountSupport;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Services\Jmap\JmapCapabilities;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * #1517: a FileNode/set content write to a Docs document is an outside
 * write, like a WebDAV PUT (#1349). Docs detects it on the next yjs read.
 */
final class DocsJmapExternalWriteTest extends WgwDatabaseTestCase
{
    use SendsFramedCollaboration;

    private const ROOM = '/users/alice/together.md';

    private const DOCUMENT_KEY = 'users/alice/together.md';

    private const SIDECAR_KEY = 'users/alice/.together.md.yjs';

    private const YJS = "\x01\x02\x03";

    private string $token = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';
        $this->seedWgwUser('alice', displayName: 'Alice');

        $installRoot = sys_get_temp_dir().'/wgw-jmap-external-write-'.uniqid('', true);
        mkdir($installRoot, 0775, true);
        file_put_contents($installRoot.'/index.php', "<?php\n");
        $dataDir = $installRoot.'/wgw-content';
        mkdir($dataDir.'/files/users/alice', 0775, true);
        WgwInstallFixture::bindInstallRoot($installRoot, $dataDir);
        WgwInstallFixture::markInstalled($installRoot, $dataDir, 'alice');
        config(['wgw.install_root' => $installRoot, 'wgw.data_dir' => $dataDir]);
        WgwInstallFixture::forgetInstallBindings();
        WgwInstallFixture::purgeDatabaseConnection();
        $this->setAppSetting(WgwSettings::BROWSER_PLUGIN, false);
        WgwTestDisks::refresh($dataDir);
        $this->configureWgwJwtKeys();
        $this->token = $this->issueBearerToken();
    }

    /** The Drive upload over an existing name: an update of its blobId. */
    public function test_an_update_after_a_collab_save_is_detected(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $this->updateBlob(self::DOCUMENT_KEY, "# Uploaded in Drive\n");

        $this->assertSame("# Uploaded in Drive\n", Storage::disk('wgw_files')->get(self::DOCUMENT_KEY));
        $response = $this->readYjs();
        $response->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
        $this->assertSame(self::YJS, $response->getContent());
    }

    /** A document saved before #1349 has a sidecar and no row yet. */
    public function test_the_first_update_to_a_document_without_a_row_is_detected(): void
    {
        $this->seedWithoutRow();

        $this->updateBlob(self::DOCUMENT_KEY, "# Uploaded in Drive\n");

        $row = DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->sole();
        $this->assertSame(hash('sha256', '# doc'), $row->content_etag);
        $this->assertSame(sha1('yjs-bytes'), $row->sidecar_etag);
        $this->readYjs()->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
    }

    /** The open editor's next autosave must not write over the upload unseen. */
    public function test_an_autosave_over_an_update_is_refused(): void
    {
        $etag = (string) $this->saveThroughTheApp("# Doc\n")->headers->get('ETag');

        $this->updateBlob(self::DOCUMENT_KEY, "# Uploaded in Drive\n");

        $this->withBearer($this->token)
            ->putCollaboration($this->documentUrl(), "# Doc, edited\n", "\x05", ['If-Match' => $etag])
            ->assertStatus(409)
            ->assertExactJson(['error' => 'external_write']);
        $this->assertSame("# Uploaded in Drive\n", Storage::disk('wgw_files')->get(self::DOCUMENT_KEY));
    }

    public function test_a_refused_update_leaves_no_row(): void
    {
        $this->seedWithoutRow();
        $id = $this->nodeId(self::DOCUMENT_KEY);

        $this->jmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => [$id => ['blobId' => 'jb-unknown']]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.notUpdated.'.$id.'.type', 'invalidProperties');

        $this->assertSame('# doc', Storage::disk('wgw_files')->get(self::DOCUMENT_KEY));
        $this->assertSame(0, DocYjsState::query()->count());
    }

    /**
     * A sidecar left behind without its document (a delete outside the
     * app): a new file under that name must not open as the old history.
     */
    public function test_a_create_where_only_the_sidecar_is_left_is_detected(): void
    {
        Storage::disk('wgw_files')->put(self::SIDECAR_KEY, 'yjs-bytes');

        $this->createFile('together.md', "# Uploaded in Drive\n")
            ->assertJsonPath('methodResponses.0.1.created.f0.name', 'together.md');

        $row = DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->sole();
        $this->assertSame(hash('sha256', ''), $row->content_etag);
        $this->readYjs()->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
    }

    /**
     * onExists=replace still destroys the old node, but Docs keys a document
     * by its path: the sidecar and its row stay, so the upload is an outside
     * write like an update. A client holding the old state must not keep it.
     */
    public function test_a_create_that_replaces_a_collab_document_is_detected(): void
    {
        $etag = (string) $this->saveThroughTheApp("# Doc\n")->headers->get('ETag');
        $oldId = $this->nodeId(self::DOCUMENT_KEY);

        $this->createFile('together.md', "# Uploaded in Drive\n", 'replace')
            ->assertJsonPath('methodResponses.0.1.created.f0.name', 'together.md')
            ->assertJsonPath('methodResponses.0.1.destroyed.0', $oldId);

        $disk = Storage::disk('wgw_files');
        $this->assertSame("# Uploaded in Drive\n", $disk->get(self::DOCUMENT_KEY));
        $this->assertSame(self::YJS, $disk->get(self::SIDECAR_KEY));
        $response = $this->readYjs();
        $response->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
        $this->assertSame(self::YJS, $response->getContent());
        $this->withBearer($this->token)
            ->putCollaboration($this->documentUrl(), "# Doc, edited\n", "\x05", ['If-Match' => $etag])
            ->assertStatus(409)
            ->assertExactJson(['error' => 'external_write']);
        $this->assertSame("# Uploaded in Drive\n", $disk->get(self::DOCUMENT_KEY));
    }

    public function test_a_replace_over_a_document_without_a_row_is_detected(): void
    {
        $this->seedWithoutRow();
        $this->nodeId(self::DOCUMENT_KEY);

        $this->createFile('together.md', "# Uploaded in Drive\n", 'replace');

        $row = DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->sole();
        $this->assertSame(hash('sha256', '# doc'), $row->content_etag);
        $this->readYjs()->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
    }

    /** A plain destroy still takes the Docs state with the document. */
    public function test_a_destroy_still_removes_the_sidecar_and_row(): void
    {
        $this->saveThroughTheApp("# Doc\n");
        $id = $this->nodeId(self::DOCUMENT_KEY);

        $this->jmap([
            ['FileNode/set', ['accountId' => 'alice', 'destroy' => [$id]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.destroyed.0', $id);

        $this->assertFalse(Storage::disk('wgw_files')->exists(self::SIDECAR_KEY));
        $this->assertSame(0, DocYjsState::query()->count());
    }

    public function test_a_write_to_a_file_without_a_sidecar_records_nothing(): void
    {
        Storage::disk('wgw_files')->put('users/alice/plain.md', '# plain');

        $this->updateBlob('users/alice/plain.md', '# changed');
        $this->createFile('new.md', '# new');

        $this->assertSame('# changed', Storage::disk('wgw_files')->get('users/alice/plain.md'));
        $this->assertSame(0, DocYjsState::query()->count());
    }

    private function updateBlob(string $key, string $contents): void
    {
        $id = $this->nodeId($key);
        $blobId = $this->uploadBlob($contents);

        $this->jmap([
            ['FileNode/set', ['accountId' => 'alice', 'update' => [$id => ['blobId' => $blobId]]], 'c0'],
        ])->assertOk()->assertJsonPath('methodResponses.0.1.updated.'.$id.'.size', strlen($contents));
    }

    private function createFile(string $name, string $contents, ?string $onExists = null): TestResponse
    {
        $parentId = $this->nodeId('users/alice');
        $args = [
            'accountId' => 'alice',
            'create' => ['f0' => ['parentId' => $parentId, 'name' => $name, 'blobId' => $this->uploadBlob($contents)]],
        ];
        if ($onExists !== null) {
            $args['onExists'] = $onExists;
        }

        return $this->jmap([['FileNode/set', $args, 'c0']])->assertOk();
    }

    private function nodeId(string $key): string
    {
        app(FileNodeAccountSupport::class)->ensureAccountIndexed('alice');
        $index = app(FileNodeIndexService::class);
        $node = $index->liveByKey($key) ?? $index->recordCreate($key);
        $this->assertNotNull($node);

        return (string) $node->node_id;
    }

    private function uploadBlob(string $contents): string
    {
        return (string) $this->call(
            'POST',
            '/api/v1/jmap/upload/alice',
            server: $this->transformHeadersToServerVars([
                'Authorization' => 'Bearer '.$this->token,
                'Content-Type' => 'text/markdown',
            ]),
            content: $contents,
        )->json('blobId');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmap(array $methodCalls): TestResponse
    {
        return $this->withBearer($this->token)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::FILENODE],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function saveThroughTheApp(string $markdown): TestResponse
    {
        return $this->withBearer($this->token)
            ->putCollaboration($this->documentUrl(), $markdown, self::YJS)
            ->assertOk();
    }

    private function seedWithoutRow(): void
    {
        Storage::disk('wgw_files')->put(self::DOCUMENT_KEY, '# doc');
        Storage::disk('wgw_files')->put(self::SIDECAR_KEY, 'yjs-bytes');
    }

    private function readYjs(): TestResponse
    {
        return $this->withBearer($this->token)->get($this->documentUrl().'&format=yjs');
    }

    private function documentUrl(): string
    {
        return '/api/v1/files/collaboration?path='.urlencode(self::ROOM);
    }
}

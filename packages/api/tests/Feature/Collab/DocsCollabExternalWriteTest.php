<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Models\DocYjsState;
use App\Services\Collab\CollabExternalWrite;
use App\Services\Jmap\FileNodes\FileNodeIndexService;
use App\Support\WgwSettings;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwInstallFixture;
use Tests\Support\WgwTestDisks;

/**
 * #1349: the yjs read flags a Docs document whose markdown changed outside
 * the collab path. The row links the sidecar to the markdown it was saved with.
 */
final class DocsCollabExternalWriteTest extends WgwDatabaseTestCase
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

        $installRoot = sys_get_temp_dir().'/wgw-external-write-'.uniqid('', true);
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

    public function test_a_collab_save_records_which_markdown_the_sidecar_belongs_to(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $row = DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->sole();
        $this->assertSame(hash('sha256', "# Doc\n"), $row->content_etag);
        $this->assertSame(sha1(self::YJS), $row->sidecar_etag);
        $this->assertSame(hash('sha256', self::DOCUMENT_KEY), $row->storage_key_hash);
    }

    public function test_markdown_changed_outside_sets_the_header_and_leaves_the_sidecar(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $this->dav('PUT', '/files/users/alice/together.md', "# Changed in an editor\n")
            ->assertSuccessful();

        $response = $this->readYjs();
        $response->assertOk();
        $response->assertHeader(CollabExternalWrite::HEADER, '1');
        $this->assertSame(self::YJS, $response->getContent());
        $this->assertSame(self::YJS, Storage::disk('wgw_files')->get(self::SIDECAR_KEY));
    }

    public function test_an_equal_markdown_hash_does_not_set_the_header(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $this->dav('PUT', '/files/users/alice/together.md', "# Doc\n")->assertSuccessful();

        $response = $this->readYjs();
        $response->assertOk();
        $response->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_a_document_without_a_row_is_a_normal_read(): void
    {
        $this->seedWithoutRow();

        $response = $this->readYjs();
        $response->assertOk();
        $response->assertHeaderMissing(CollabExternalWrite::HEADER);
        $this->assertSame('yjs-bytes', $response->getContent());
    }

    public function test_a_conditional_read_does_not_304_while_the_flag_is_set(): void
    {
        $etag = (string) $this->saveThroughTheApp("# Doc\n")->headers->get('ETag');
        Storage::disk('wgw_files')->put(self::DOCUMENT_KEY, "# Changed on disk\n");

        $response = $this->withBearer($this->token)
            ->withHeaders(['If-None-Match' => $etag])
            ->get($this->yjsUrl());

        $response->assertOk();
        $response->assertHeader(CollabExternalWrite::HEADER, '1');
        $response->assertHeader('ETag', $etag);
        $this->assertSame(self::YJS, $response->getContent());
    }

    public function test_a_conditional_read_still_304s_without_the_flag(): void
    {
        $etag = (string) $this->saveThroughTheApp("# Doc\n")->headers->get('ETag');

        $this->withBearer($this->token)
            ->withHeaders(['If-None-Match' => $etag])
            ->get($this->yjsUrl())
            ->assertStatus(304);
    }

    public function test_the_next_app_save_clears_the_flag(): void
    {
        $etag = (string) $this->saveThroughTheApp("# Doc\n")->headers->get('ETag');
        $this->dav('PUT', '/files/users/alice/together.md', "# Outside\n")->assertSuccessful();

        $this->withBearer($this->token)
            ->putCollaboration($this->documentUrl(), "# Outside\n", "\x04", ['If-Match' => $etag])
            ->assertOk();

        $this->readYjs()->assertOk()->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_the_first_dav_write_to_a_document_without_a_row_is_detected(): void
    {
        $this->seedWithoutRow();

        $this->dav('PUT', '/files/users/alice/together.md', "# Outside\n")->assertSuccessful();

        $row = DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->sole();
        $this->assertSame(hash('sha256', '# doc'), $row->content_etag);
        $this->readYjs()->assertOk()->assertHeader(CollabExternalWrite::HEADER, '1');
    }

    /**
     * The collab guard no longer refuses PATCH. This server registers no
     * Sabre partial-update plugin, so PATCH is 501 for every file.
     */
    public function test_a_dav_patch_is_no_longer_refused_by_the_collab_guard(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $response = $this->dav('PATCH', '/files/users/alice/together.md', 'X', [
            'CONTENT_TYPE' => 'application/x-sabredav-partialupdate',
            'HTTP_X_UPDATE_RANGE' => 'bytes=0-0',
        ]);

        $this->assertNotSame(403, $response->getStatusCode());
        $this->assertSame(self::YJS, Storage::disk('wgw_files')->get(self::SIDECAR_KEY));
    }

    public function test_a_rename_carries_the_row_and_is_not_a_content_change(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $moved = $this->dav('MOVE', '/files/users/alice/together.md', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/renamed.md',
        ]);

        $this->assertContains($moved->getStatusCode(), [201, 204]);
        $this->assertNull(DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->first());
        $row = DocYjsState::query()->where('storage_key', 'users/alice/renamed.md')->sole();
        $this->assertSame(hash('sha256', 'users/alice/renamed.md'), $row->storage_key_hash);
        $this->readYjs('/users/alice/renamed.md')
            ->assertOk()
            ->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_a_folder_move_carries_the_rows_inside_it(): void
    {
        Storage::disk('wgw_files')->makeDirectory('users/alice/notes');
        $this->saveThroughTheApp("# Doc\n", '/users/alice/notes/together.md');

        $moved = $this->dav('MOVE', '/files/users/alice/notes', server: [
            'HTTP_DESTINATION' => 'http://localhost/files/users/alice/archive',
        ]);

        $this->assertContains($moved->getStatusCode(), [201, 204]);
        $this->assertNull(DocYjsState::query()->where('storage_key', 'users/alice/notes/together.md')->first());
        $this->assertNotNull(DocYjsState::query()->where('storage_key', 'users/alice/archive/together.md')->first());
        $this->readYjs('/users/alice/archive/together.md')
            ->assertOk()
            ->assertHeaderMissing(CollabExternalWrite::HEADER);
    }

    public function test_delete_takes_the_row_with_it(): void
    {
        $this->saveThroughTheApp("# Doc\n");

        $this->dav('DELETE', '/files/users/alice/together.md')->assertStatus(204);

        $this->assertSame(0, DocYjsState::query()->count());
    }

    public function test_a_folder_delete_takes_the_rows_inside_it(): void
    {
        Storage::disk('wgw_files')->makeDirectory('users/alice/notes');
        $this->saveThroughTheApp("# Doc\n", '/users/alice/notes/together.md');

        $this->dav('DELETE', '/files/users/alice/notes')->assertStatus(204);

        $this->assertSame(0, DocYjsState::query()->count());
    }

    public function test_a_reindex_does_not_move_or_delete_the_row(): void
    {
        $this->saveThroughTheApp("# Doc\n");
        $index = $this->app->make(FileNodeIndexService::class);

        $index->recordMove(self::DOCUMENT_KEY, 'users/alice/elsewhere.md');
        $index->recordDelete('users/alice/elsewhere.md');

        $this->assertNotNull(DocYjsState::query()->where('storage_key', self::DOCUMENT_KEY)->first());
        $this->assertNull(DocYjsState::query()->where('storage_key', 'users/alice/elsewhere.md')->first());
    }

    private function saveThroughTheApp(string $markdown, string $room = self::ROOM): TestResponse
    {
        return $this->withBearer($this->token)
            ->putCollaboration($this->documentUrl($room), $markdown, self::YJS)
            ->assertOk();
    }

    private function seedWithoutRow(): void
    {
        Storage::disk('wgw_files')->put(self::DOCUMENT_KEY, '# doc');
        Storage::disk('wgw_files')->put(self::SIDECAR_KEY, 'yjs-bytes');
    }

    private function readYjs(string $room = self::ROOM): TestResponse
    {
        return $this->withBearer($this->token)->get($this->yjsUrl($room));
    }

    private function documentUrl(string $room = self::ROOM): string
    {
        return '/api/v1/files/collaboration?path='.urlencode($room);
    }

    private function yjsUrl(string $room = self::ROOM): string
    {
        return $this->documentUrl($room).'&format=yjs';
    }

    /**
     * @param  array<string, string>  $server
     */
    private function dav(string $method, string $path, ?string $body = null, array $server = []): TestResponse
    {
        $server['HTTP_AUTHORIZATION'] = 'Basic '.base64_encode('alice:secret');

        return $this->call($method, $path, [], [], [], $server, $body);
    }
}

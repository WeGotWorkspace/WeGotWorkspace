<?php

declare(strict_types=1);

namespace Tests\Feature\Collab;

use App\Http\Controllers\Api\V1\Files\FilesController;
use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\SendsFramedCollaboration;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

/**
 * `GET /files/collaboration?format=yjs&fallback=markdown` answers a document without a
 * sidecar with its markdown in the same response, so offline sync needs one request per
 * text file. Without the opt-in, "no sidecar" stays a 204 (C7).
 */
final class CollabMarkdownFallbackTest extends WgwDatabaseTestCase
{
    use SendsFramedCollaboration;

    private const ROOM = '/users/alice/docs/plain.md';

    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-collab-fallback-'.uniqid('', true));
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

    private function yjsUrl(string $suffix = ''): string
    {
        return '/api/v1/files/collaboration?path='.urlencode(self::ROOM).'&format=yjs'.$suffix;
    }

    public function test_without_a_sidecar_the_fallback_returns_the_markdown_marked(): void
    {
        app(WgwStorage::class)->files()->put('users/alice/docs/plain.md', "# Plain\n\nUploaded text.\n");
        $token = $this->issueBearerToken();

        $response = $this->withBearer($token)
            ->get($this->yjsUrl('&fallback=markdown'))
            ->assertOk()
            ->assertHeader('Content-Type', 'text/markdown; charset=utf-8')
            ->assertHeader(FilesController::COLLAB_FALLBACK_HEADER, 'markdown')
            ->assertHeader('ETag');
        $this->assertSame("# Plain\n\nUploaded text.\n", $response->getContent());
    }

    public function test_without_the_opt_in_no_sidecar_is_still_204(): void
    {
        app(WgwStorage::class)->files()->put('users/alice/docs/plain.md', "# Plain\n");
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->get($this->yjsUrl())
            ->assertNoContent()
            ->assertHeaderMissing(FilesController::COLLAB_FALLBACK_HEADER);
    }

    public function test_with_a_sidecar_the_fallback_returns_the_sidecar_unmarked(): void
    {
        $token = $this->issueBearerToken();
        $this->withBearer($token)
            ->putCollaboration(
                '/api/v1/files/collaboration?path='.urlencode(self::ROOM),
                "# Plain\n",
                "\x01\x02\x03\xff",
            )
            ->assertOk();

        $this->withBearer($token)
            ->get($this->yjsUrl('&fallback=markdown'))
            ->assertOk()
            ->assertHeader('Content-Type', 'application/octet-stream')
            ->assertHeaderMissing(FilesController::COLLAB_FALLBACK_HEADER)
            ->assertContent("\x01\x02\x03\xff");
    }
}

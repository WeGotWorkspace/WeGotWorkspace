<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Storage\WgwStorage;
use Illuminate\Support\Facades\File;
use Tests\Support\WgwDatabaseTestCase;
use Tests\Support\WgwTestDisks;

final class FilesEndpointsTest extends WgwDatabaseTestCase
{
    private string $dataDir = '';

    protected function setUp(): void
    {
        parent::setUp();

        putenv('WGW_DISABLE_LOGIN_THROTTLE=1');
        $_ENV['WGW_DISABLE_LOGIN_THROTTLE'] = '1';

        $this->dataDir = storage_path('framework/testing/wgw-files-'.uniqid('', true));
        File::ensureDirectoryExists($this->dataDir.'/files/users/alice');
        WgwTestDisks::refresh($this->dataDir);
        $this->configureWgwJwtKeys();

        $this->seedWgwUser('alice', displayName: 'Alice');

        app(WgwStorage::class)->files()->put('users/alice/welcome.txt', 'hello');
    }

    protected function tearDown(): void
    {
        if ($this->dataDir !== '' && File::isDirectory($this->dataDir)) {
            File::deleteDirectory($this->dataDir);
        }

        parent::tearDown();
    }

    public function test_files_context_listing_and_star_flow(): void
    {
        $token = $this->issueBearerToken();

        $user = $this->withBearer($token)->getJson('/api/v1/files/context');
        $user->assertOk()
            ->assertJsonPath('data.username', 'alice')
            ->assertJsonPath('data.name', 'Alice')
            ->assertJsonPath('data.roots', ['/users', '/groups']);

        $listing = $this->withBearer($token)->getJson('/api/v1/files/children?path=/users/alice');
        $listing->assertOk()
            ->assertJsonPath('data.location', '/users/alice/')
            ->assertJsonFragment(['name' => 'welcome.txt', 'type' => 'file']);

        $star = $this->withBearer($token)->postJson('/api/v1/files/star?path=/users/alice/welcome.txt');
        $star->assertOk()->assertJsonPath('data', 'Updated');

        $stars = $this->withBearer($token)->getJson('/api/v1/files/starred');
        $stars->assertOk()
            ->assertJsonPath('data.paths', ['/users/alice/welcome.txt']);
    }

    public function test_files_content_downloads_by_plain_path_query(): void
    {
        $token = $this->issueBearerToken();

        $response = $this->withBearer($token)
            ->get('/api/v1/files/content?path=/users/alice/welcome.txt');

        $response->assertOk()
            ->assertHeader('content-type', 'text/plain; charset=utf-8');

        $this->assertSame('hello', $response->streamedContent());
    }

    public function test_post_files_content_returns_method_not_allowed(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->post('/api/v1/files/content?path=/users/alice', [])
            ->assertStatus(405);
    }

    public function test_deleted_dual_rest_write_routes_are_gone(): void
    {
        $token = $this->issueBearerToken();

        $this->withBearer($token)
            ->postJson('/api/v1/files/directories?path=/users/alice', ['name' => 'Projects'])
            ->assertNotFound();
        $this->withBearer($token)
            ->patchJson('/api/v1/files?path=/users/alice/welcome.txt', ['name' => 'hello.txt'])
            ->assertStatus(405);
        $this->withBearer($token)
            ->deleteJson('/api/v1/files?path=/users/alice/welcome.txt')
            ->assertStatus(405);
    }
}

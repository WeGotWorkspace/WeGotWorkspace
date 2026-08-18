<?php

declare(strict_types=1);

namespace Tests\Feature\Docs;

use App\Services\Drive\DriveService;
use Illuminate\Support\Facades\Storage;
use Tests\Support\DocsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class DocsPrivateDriveTest extends WgwDatabaseTestCase
{
    use DocsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDocsFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDocsFixtures();
        parent::tearDown();
    }

    public function test_load_private_markdown_document(): void
    {
        $token = $this->userBearerToken();
        $path = $this->seedDocFile('bob', 'report.md', "# Report\n\nQuarterly summary.");

        $response = $this->getDocContent($token, $path);

        $response->assertOk()
            ->assertHeader('content-type', 'text/markdown; charset=utf-8');
        $this->assertStringContainsString('# Report', $response->streamedContent());
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/docs/report.md'));
    }

    public function test_save_markdown_via_drive_service(): void
    {
        $token = $this->userBearerToken();

        $this->assertSame('Stored', $this->storeDoc('bob', '/users/bob/docs', 'note.md', "# Draft\n\nFirst save."));

        $download = $this->getDocContent($token, '/users/bob/docs/note.md');
        $download->assertOk();
        $this->assertStringContainsString('First save.', $download->streamedContent());
    }

    public function test_second_store_overwrites_prior_markdown(): void
    {
        $token = $this->userBearerToken();
        $parent = '/users/bob/docs';

        $this->storeDoc('bob', $parent, 'note.md', "# Draft\n\nVersion one.");
        $this->storeDoc('bob', $parent, 'note.md', "# Draft\n\nVersion two.");

        $download = $this->getDocContent($token, '/users/bob/docs/note.md');
        $download->assertOk();
        $body = $download->streamedContent();
        $this->assertStringContainsString('Version two.', $body);
        $this->assertStringNotContainsString('Version one.', $body);
    }

    public function test_plain_text_document_round_trip(): void
    {
        $token = $this->userBearerToken();

        $this->storeDoc('bob', '/users/bob/docs', 'readme.txt', "Plain text doc.\n");

        $download = $this->getDocContent($token, '/users/bob/docs/readme.txt');
        $download->assertOk()
            ->assertHeader('content-type', 'text/plain; charset=utf-8');
        $this->assertSame("Plain text doc.\n", $download->streamedContent());
    }

    public function test_rename_private_document_preserves_content(): void
    {
        $token = $this->userBearerToken();
        $this->seedDocFile('bob', 'old.md', '# Old title');

        $this->assertSame('Renamed', app(DriveService::class)->renameItem(
            $this->drivePrincipal('bob'),
            '/users/bob/docs',
            '/users/bob/docs/old.md',
            'new.md',
        ));

        $this->assertFalse(Storage::disk('wgw_files')->exists('users/bob/docs/old.md'));
        $this->assertTrue(Storage::disk('wgw_files')->exists('users/bob/docs/new.md'));

        $download = $this->getDocContent($token, '/users/bob/docs/new.md');
        $download->assertOk();
        $this->assertStringContainsString('# Old title', $download->streamedContent());

        $oldPath = $this->getDocContent($token, '/users/bob/docs/old.md');
        $oldPath->assertStatus(400)->assertJsonPath('error', 'File not found.');
    }

    public function test_admin_can_load_and_save_own_private_docs(): void
    {
        $token = $this->adminBearerToken();

        $this->storeDoc('alice', '/users/alice/docs', 'admin-note.md', "# Admin doc\n");

        $download = $this->getDocContent($token, '/users/alice/docs/admin-note.md');
        $download->assertOk();
        $this->assertStringContainsString('# Admin doc', $download->streamedContent());
    }
}

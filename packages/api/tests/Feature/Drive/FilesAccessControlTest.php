<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Storage\WgwStorage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class FilesAccessControlTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_authenticated_user_downloads_markdown_in_private_drive(): void
    {
        $token = $this->userBearerToken();
        app(WgwStorage::class)->files()->put('users/bob/notes.md', "# Notes\nHello drive");

        $listing = $this->withBearer($token)->getJson('/api/v1/files/children?path=/users/bob');
        $listing->assertOk()
            ->assertJsonFragment(['name' => 'notes.md', 'type' => 'file']);

        $download = $this->withBearer($token)->get('/api/v1/files/content?path=/users/bob/notes.md');
        $download->assertOk();
        $this->assertStringContainsString('Hello drive', $download->streamedContent());
    }

    public function test_owner_can_download_after_cross_user_content_stays_private(): void
    {
        $this->seedPrivateFile('carol', 'private.md', 'carol secret');

        $content = $this->withBearer($this->carolBearerToken())
            ->get('/api/v1/files/content?path=/users/carol/private.md');
        $content->assertOk();
        $this->assertSame('carol secret', $content->streamedContent());

        $bobDownload = $this->withBearer($this->userBearerToken())
            ->get('/api/v1/files/content?path=/users/carol/private.md');
        $bobDownload->assertStatus(400);
    }

    public function test_group_read_acl_allows_member_and_denies_non_member(): void
    {
        $this->seedGroupFile('readme.md', 'team readme');
        $bobToken = $this->userBearerToken();
        $carolToken = $this->carolBearerToken();

        $memberListing = $this->withBearer($bobToken)->getJson('/api/v1/files/children?path=/groups/team');
        $memberListing->assertOk()->assertJsonFragment(['name' => 'readme.md']);

        $download = $this->withBearer($bobToken)->get('/api/v1/files/content?path=/groups/team/readme.md');
        $download->assertOk();
        $this->assertSame('team readme', $download->streamedContent());

        $nonMemberListing = $this->withBearer($carolToken)->getJson('/api/v1/files/children?path=/groups/team');
        $this->assertAccessDenied($nonMemberListing);
    }

    public function test_admin_does_not_bypass_private_path_acl(): void
    {
        $this->seedPrivateFile('carol', 'admin-proof.md', 'stay private');
        $adminToken = $this->adminBearerToken();

        $listing = $this->withBearer($adminToken)->getJson('/api/v1/files/children?path=/users/carol');
        $this->assertAccessDenied($listing);

        $download = $this->withBearer($adminToken)->get('/api/v1/files/content?path=/users/carol/admin-proof.md');
        $download->assertStatus(400);
    }

    public function test_admin_with_group_membership_can_access_team_drive(): void
    {
        $this->seedGroupFile('admin-shared.md', 'admin can read');
        $adminToken = $this->adminBearerToken();

        $this->withBearer($adminToken)->getJson('/api/v1/files/children?path=/groups/team')
            ->assertOk()
            ->assertJsonFragment(['name' => 'admin-shared.md']);
    }

    /**
     * @return iterable<string, array{0: string, 1: string, 2: array<string, mixed>|null}>
     */
    public static function guestFilesRoutesProvider(): iterable
    {
        yield 'GET context' => ['GET', '/api/v1/files/context', null];
        yield 'GET children' => ['GET', '/api/v1/files/children?path=/users/bob', null];
        yield 'GET search' => ['GET', '/api/v1/files?search=ab', null];
        yield 'GET content' => ['GET', '/api/v1/files/content?path=/users/bob/x.md', null];
        yield 'POST star' => ['POST', '/api/v1/files/star?path=/users/bob/x.md', null];
        yield 'DELETE star' => ['DELETE', '/api/v1/files/star?path=/users/bob/x.md', null];
        yield 'GET starred' => ['GET', '/api/v1/files/starred', null];
    }

    #[DataProvider('guestFilesRoutesProvider')]
    public function test_guest_files_routes_return_unauthorized(string $method, string $uri, ?array $body): void
    {
        if ($method === 'GET') {
            $this->getJson($uri)->assertUnauthorized();
        } elseif ($method === 'DELETE') {
            $this->deleteJson($uri)->assertUnauthorized();
        } elseif ($method === 'POST' && $body === null) {
            $this->postJson($uri)->assertUnauthorized();
        } else {
            $this->json($method, $uri, $body ?? [])->assertUnauthorized();
        }
    }

    public function test_drive_search_returns_hits_only_within_allowed_paths(): void
    {
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'findme-bob.md');
        $this->createDriveFile($this->carolBearerToken(), '/users/carol', 'findme-carol.md');

        $results = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files?search=findme');

        $results->assertOk();
        $names = array_column((array) $results->json('data.files'), 'name');
        $this->assertContains('findme-bob.md', $names);
        $this->assertNotContains('findme-carol.md', $names);
    }

    public function test_notes_directory_is_hidden_from_children_listing(): void
    {
        app(WgwStorage::class)->files()->put('users/bob/.notes/hidden-note.md', 'note body');
        app(WgwStorage::class)->files()->put('users/bob/visible.md', 'visible');

        $listing = $this->withBearer($this->userBearerToken())
            ->getJson('/api/v1/files/children?path=/users/bob');

        $listing->assertOk()->assertJsonFragment(['name' => 'visible.md']);
        $names = array_column((array) $listing->json('data.files'), 'name');
        $this->assertNotContains('.notes', $names);
    }
}

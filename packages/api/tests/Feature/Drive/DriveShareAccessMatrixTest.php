<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use Illuminate\Http\UploadedFile;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Group;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

#[Group('MySQLParity')]
final class DriveShareAccessMatrixTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const SHARE_ROOT = '/users/bob/workspace';

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/directories?path=/users/bob', [
            'name' => 'workspace',
        ])->assertOk();
        $this->createDriveFile($this->ownerToken, self::SHARE_ROOT, 'plan.md');
        $this->createDriveFile($this->ownerToken, self::SHARE_ROOT, 'notes.txt');
        $this->createDriveFile($this->ownerToken, self::SHARE_ROOT, 'report.pdf');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string, 1: bool, 2: bool, 3: bool}>
     */
    public static function accessProvider(): iterable
    {
        yield 'view' => ['view', true, false, false];
        yield 'edit' => ['edit', true, true, false];
        yield 'full' => ['full', true, true, true];
    }

    #[DataProvider('accessProvider')]
    public function test_member_grant_access_matrix_subset(string $access, bool $mayRead, bool $mayEditContent, bool $mayManageStructure): void
    {
        $this->createMemberShareForCarol($access);
        $memberToken = $this->carolBearerToken();

        $children = $this->withBearer($memberToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT);
        $mayRead ? $children->assertOk() : $children->assertStatus(400);

        $upload = $this->withBearer($memberToken)->post('/api/v1/files/content?path='.self::SHARE_ROOT, [
            'file' => UploadedFile::fake()->createWithContent('plan.md', 'edited'),
            'resumableFilename' => 'plan.md',
            'resumableIdentifier' => 'member-edit',
            'resumableChunkNumber' => 1,
            'resumableTotalChunks' => 1,
        ]);
        $mayEditContent ? $upload->assertOk() : $upload->assertStatus(400);

        $create = $this->withBearer($memberToken)->postJson('/api/v1/files/directories?path='.self::SHARE_ROOT, [
            'name' => 'new-dir',
            'type' => 'dir',
        ]);
        $mayManageStructure ? $create->assertOk() : $create->assertStatus(400);
    }

    public function test_guest_session_access_matrix_view_only_public_link(): void
    {
        $publicToken = $this->createPublicShare('view');
        $guestToken = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk()->json('access_token');

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path='.self::SHARE_ROOT)
            ->assertOk();

        $this->withBearer($guestToken)->post('/api/v1/files/content?path='.self::SHARE_ROOT, [
            'file' => UploadedFile::fake()->createWithContent('plan.md', 'guest edited'),
            'resumableFilename' => 'plan.md',
            'resumableIdentifier' => 'guest-edit',
            'resumableChunkNumber' => 1,
            'resumableTotalChunks' => 1,
        ])->assertStatus(400);

        $this->withBearer($guestToken)->postJson('/api/v1/files/directories?path='.self::SHARE_ROOT, [
            'name' => 'guest-dir',
            'type' => 'dir',
        ])->assertStatus(400);
    }

    private function createMemberShareForCarol(string $access): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'member',
            'defaultAccess' => $access,
            'shareWith' => [
                'carol' => ['access' => $access],
            ],
        ])->assertOk();
    }

    private function createPublicShare(string $access): string
    {
        $response = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'public',
            'defaultAccess' => $access,
        ]);
        $response->assertOk();

        return (string) $response->json('data.publicToken');
    }

    public function test_public_share_rejects_non_view_default_access(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'public',
            'defaultAccess' => 'edit',
        ])->assertStatus(400);
    }

    /**
     * @return iterable<string, array{0: string, 1: string}>
     */
    public static function singleFileTargetProvider(): iterable
    {
        yield 'markdown' => ['plan.md', self::SHARE_ROOT.'/plan.md'];
        yield 'pdf' => ['report.pdf', self::SHARE_ROOT.'/report.pdf'];
        yield 'text' => ['notes.txt', self::SHARE_ROOT.'/notes.txt'];
    }

    #[DataProvider('singleFileTargetProvider')]
    public function test_view_grant_on_single_file_allows_read_and_denies_mutations(string $filename, string $path): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $path,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['carol' => ['access' => 'view']],
        ])->assertOk();

        $memberToken = $this->carolBearerToken();

        $this->withBearer($memberToken)->get('/api/v1/files/content?path='.urlencode($path))
            ->assertOk();

        $this->withBearer($memberToken)->patchJson('/api/v1/files?path='.urlencode($path), [
            'name' => 'renamed-'.$filename,
        ])->assertStatus(400);

        $this->withBearer($memberToken)->deleteJson('/api/v1/files?path='.urlencode($path))
            ->assertStatus(400);

        $this->withBearer($memberToken)->patchJson('/api/v1/files?path='.urlencode($path), [
            'destination' => '/users/carol',
        ])->assertStatus(400);
    }

    public function test_view_grant_denies_star_and_search_outside_share_scope(): void
    {
        $this->createMemberShareForCarol('view');
        $memberToken = $this->carolBearerToken();

        $this->withBearer($memberToken)->postJson('/api/v1/files/star?path='.self::SHARE_ROOT.'/plan.md')
            ->assertStatus(400);

        $search = $this->withBearer($memberToken)->getJson('/api/v1/files?search=plan');
        $search->assertOk();
        $names = array_column((array) $search->json('data.files'), 'name');
        $this->assertContains('plan.md', $names);
        $this->assertNotContains('notes.txt', $names);
    }

    public function test_edit_grant_allows_content_upload_but_denies_structure_ops(): void
    {
        $this->createMemberShareForCarol('edit');
        $memberToken = $this->carolBearerToken();

        $this->withBearer($memberToken)->patchJson('/api/v1/files?path='.self::SHARE_ROOT.'/plan.md', [
            'name' => 'renamed-plan.md',
        ])->assertStatus(400);

        $this->withBearer($memberToken)->deleteJson('/api/v1/files?path='.self::SHARE_ROOT.'/plan.md')
            ->assertStatus(400);

        $this->withBearer($memberToken)->post('/api/v1/files/content?path='.self::SHARE_ROOT, [
            'file' => UploadedFile::fake()->createWithContent('plan.md', 'edited content'),
            'resumableFilename' => 'plan.md',
            'resumableIdentifier' => 'matrix-edit-upload',
            'resumableChunkNumber' => 1,
            'resumableTotalChunks' => 1,
        ])->assertOk();
    }

    public function test_guest_view_grant_denies_rename_delete_and_star(): void
    {
        $publicToken = $this->createPublicShare('view');
        $guestToken = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk()->json('access_token');

        $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode(self::SHARE_ROOT.'/plan.md'))
            ->assertOk();

        $this->withBearer($guestToken)->patchJson('/api/v1/files?path='.urlencode(self::SHARE_ROOT.'/plan.md'), [
            'name' => 'guest-rename.md',
        ])->assertStatus(400);

        $this->withBearer($guestToken)->deleteJson('/api/v1/files?path='.urlencode(self::SHARE_ROOT.'/plan.md'))
            ->assertStatus(400);

        $this->withBearer($guestToken)->postJson('/api/v1/files/star?path='.self::SHARE_ROOT.'/plan.md')
            ->assertForbidden();
    }

    public function test_guest_public_share_of_single_vcf_allows_content_download(): void
    {
        $this->createDriveFile($this->ownerToken, '/users/bob', 'contacts.vcf');
        $vcfPath = '/users/bob/contacts.vcf';

        $share = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => $vcfPath,
            'kind' => 'public',
            'defaultAccess' => 'view',
        ])->assertOk();

        $publicToken = (string) $share->json('data.publicToken');
        $guestToken = (string) $this->postJson('/api/v1/files/share-sessions', [
            'token' => $publicToken,
        ])->assertOk()->json('access_token');

        $this->withBearer($guestToken)->getJson('/api/v1/files/children?path=/users/bob')
            ->assertStatus(400);

        $download = $this->withBearer($guestToken)->get('/api/v1/files/content?path='.urlencode($vcfPath));
        $download->assertOk();
    }
}

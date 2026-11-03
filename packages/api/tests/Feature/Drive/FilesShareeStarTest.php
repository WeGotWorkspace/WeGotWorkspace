<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * A star is per user: someone an item is shared with may star it like their own,
 * without changing the item or what anyone else sees.
 */
final class FilesShareeStarTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const SHARE_ROOT = '/users/bob/workspace';

    private const SHARED_FILE = self::SHARE_ROOT.'/plan.md';

    private string $ownerToken;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        $this->ownerToken = $this->userBearerToken();
        $this->createDriveDirectory('/users/bob', 'workspace');
        $this->createDriveFile($this->ownerToken, self::SHARE_ROOT, 'plan.md');
        $this->createDriveFile($this->ownerToken, '/users/bob', 'private.md');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    /**
     * @return iterable<string, array{0: string}>
     */
    public static function accessProvider(): iterable
    {
        yield 'view' => ['view'];
        yield 'edit' => ['edit'];
        yield 'full' => ['full'];
    }

    #[DataProvider('accessProvider')]
    public function test_sharee_can_star_and_unstar_a_shared_folder_and_file(string $access): void
    {
        $this->shareWithCarol($access);
        $carol = $this->carolBearerToken();

        foreach ([self::SHARE_ROOT, self::SHARED_FILE] as $path) {
            $this->withBearer($carol)->postJson('/api/v1/files/star?path='.$path)
                ->assertOk()
                ->assertJsonPath('data', 'Updated');
        }

        $listed = (array) $this->withBearer($carol)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->json('data.paths');
        $this->assertEqualsCanonicalizing([self::SHARE_ROOT, self::SHARED_FILE], $listed);

        $this->withBearer($carol)->deleteJson('/api/v1/files/star?path='.self::SHARED_FILE)->assertOk();

        $this->withBearer($carol)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', [self::SHARE_ROOT]);
    }

    public function test_a_sharee_star_is_invisible_to_the_owner_and_other_sharees(): void
    {
        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => [
                'carol' => ['access' => 'view'],
                'alice' => ['access' => 'view'],
            ],
        ])->assertOk();

        $this->withBearer($this->carolBearerToken())
            ->postJson('/api/v1/files/star?path='.self::SHARED_FILE)
            ->assertOk();

        $this->withBearer($this->ownerToken)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', []);
        $this->withBearer($this->adminBearerToken())->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', []);

        $rows = DB::connection('wgw')->table('drive_starred_items')->pluck('username')->all();
        $this->assertSame(['carol'], $rows);
    }

    public function test_the_owner_unstarring_does_not_change_the_sharee_star(): void
    {
        $this->shareWithCarol('view');
        $carol = $this->carolBearerToken();

        $this->withBearer($this->ownerToken)->postJson('/api/v1/files/star?path='.self::SHARED_FILE)->assertOk();
        $this->withBearer($carol)->postJson('/api/v1/files/star?path='.self::SHARED_FILE)->assertOk();
        $this->withBearer($this->ownerToken)->deleteJson('/api/v1/files/star?path='.self::SHARED_FILE)->assertOk();

        $this->withBearer($carol)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', [self::SHARED_FILE]);
        $this->withBearer($this->ownerToken)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', []);
    }

    public function test_a_caller_without_access_cannot_star_or_unstar(): void
    {
        $carol = $this->carolBearerToken();

        $this->assertAccessDenied($this->withBearer($carol)->postJson('/api/v1/files/star?path='.self::SHARED_FILE));
        $this->assertAccessDenied($this->withBearer($carol)->deleteJson('/api/v1/files/star?path='.self::SHARED_FILE));

        $this->shareWithCarol('view');

        $this->assertAccessDenied($this->withBearer($carol)->postJson('/api/v1/files/star?path=/users/bob/private.md'));
        $this->assertAccessDenied($this->withBearer($carol)->postJson('/api/v1/files/star?path=/users/bob'));

        $this->assertSame(0, DB::connection('wgw')->table('drive_starred_items')->count());
    }

    public function test_losing_access_hides_the_star_and_regaining_access_shows_it_again(): void
    {
        $shareId = $this->shareWithCarol('view');
        $carol = $this->carolBearerToken();

        $this->withBearer($carol)->postJson('/api/v1/files/star?path='.self::SHARED_FILE)->assertOk();

        $this->withBearer($this->ownerToken)->deleteJson('/api/v1/files/shares/'.$shareId)->assertOk();

        $this->withBearer($carol)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', []);

        $this->shareWithCarol('view');

        $this->withBearer($carol)->getJson('/api/v1/files/starred')
            ->assertOk()
            ->assertJsonPath('data.paths', [self::SHARED_FILE]);
    }

    private function shareWithCarol(string $access): string
    {
        $response = $this->withBearer($this->ownerToken)->postJson('/api/v1/files/shares', [
            'path' => self::SHARE_ROOT,
            'kind' => 'member',
            'defaultAccess' => $access,
            'shareWith' => [
                'carol' => ['access' => $access],
            ],
        ])->assertOk();

        return (string) $response->json('data.id');
    }
}

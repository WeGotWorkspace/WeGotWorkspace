<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use App\Storage\WgwStorage;
use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * The drive roots list every home and group drive, and each entry reports the caller's
 * own rights on it. The roots themselves are browse-only.
 */
final class DriveRootListingRightsTest extends WgwDatabaseTestCase
{
    use DriveTestFixtures;

    private const FULL_TOP_LEVEL = [
        'mayView' => true,
        'mayComment' => true,
        'mayReview' => true,
        'mayEditContent' => true,
        'mayManageStructure' => true,
        'mayShare' => false,
    ];

    private const NONE = [
        'mayView' => false,
        'mayComment' => false,
        'mayReview' => false,
        'mayEditContent' => false,
        'mayManageStructure' => false,
        'mayShare' => false,
    ];

    private const BROWSE_ONLY = [
        'mayView' => true,
        'mayComment' => false,
        'mayReview' => false,
        'mayEditContent' => false,
        'mayManageStructure' => false,
        'mayShare' => false,
    ];

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpDriveFixtures();
        app(WgwStorage::class)->files()->makeDirectory('groups/outsiders');
    }

    protected function tearDown(): void
    {
        $this->tearDownDriveFixtures();
        parent::tearDown();
    }

    public function test_users_listing_shows_every_home_with_the_callers_own_rights(): void
    {
        $rights = $this->rightsByPath($this->userBearerToken(), '/users');

        $this->assertSame(['/users/alice', '/users/bob', '/users/carol'], array_keys($rights));
        $this->assertSame(self::FULL_TOP_LEVEL, $rights['/users/bob']);
        $this->assertSame(self::NONE, $rights['/users/alice']);
        $this->assertSame(self::NONE, $rights['/users/carol']);
    }

    public function test_groups_listing_shows_every_group_drive_with_the_callers_own_rights(): void
    {
        $rights = $this->rightsByPath($this->userBearerToken(), '/groups');

        $this->assertSame(['/groups/outsiders', '/groups/team'], array_keys($rights));
        $this->assertSame(self::FULL_TOP_LEVEL, $rights['/groups/team']);
        $this->assertSame(self::NONE, $rights['/groups/outsiders']);
    }

    public function test_a_grant_inside_another_home_does_not_give_rights_on_that_home(): void
    {
        $this->seedPrivateFile('carol', 'shared.md', 'for bob');
        $this->withBearer($this->carolBearerToken())->postJson('/api/v1/files/shares', [
            'path' => '/users/carol/shared.md',
            'kind' => 'member',
            'defaultAccess' => 'view',
            'shareWith' => ['bob' => ['access' => 'edit']],
        ])->assertOk();

        $this->assertSame(self::NONE, $this->rightsByPath($this->userBearerToken(), '/users')['/users/carol']);
    }

    public function test_the_drive_roots_are_browse_only(): void
    {
        $token = $this->userBearerToken();

        $rights = $this->rightsByPath($token, '/');
        $this->assertSame(['/groups', '/users'], array_keys($rights));
        $this->assertSame(self::BROWSE_ONLY, $rights['/users']);
        $this->assertSame(self::BROWSE_ONLY, $rights['/groups']);

        $home = $this->rightsByPath($token, '/users/bob');
        $this->assertSame([], $home);
    }

    /**
     * @return array<string, array<string, bool>>
     */
    private function rightsByPath(string $token, string $dir): array
    {
        $files = $this->withBearer($token)->getJson('/api/v1/files/children?path='.rawurlencode($dir))
            ->assertOk()
            ->json('data.files');
        $rights = [];
        foreach ($files as $entry) {
            $rights[(string) $entry['path']] = $entry['myRights'];
        }
        ksort($rights);

        return $rights;
    }
}

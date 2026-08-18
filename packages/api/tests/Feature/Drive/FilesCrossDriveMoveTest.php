<?php

declare(strict_types=1);

namespace Tests\Feature\Drive;

use Tests\Support\DriveTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Cross-drive move HTTP writes were dual-REST. Authenticated twins live on
 * {@see \Tests\Feature\Jmap\JmapFileNodeAclTest}. This file stays as a
 * pointer so the former suite name still greps.
 */
final class FilesCrossDriveMoveTest extends WgwDatabaseTestCase
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

    public function test_deleted_patch_files_route_is_gone(): void
    {
        $this->createDriveFile($this->userBearerToken(), '/users/bob', 'local.md');

        $this->withBearer($this->userBearerToken())
            ->patchJson('/api/v1/files?path=/users/bob/local.md', [
                'name' => 'local.md',
                'destination' => '/groups/team',
            ])
            ->assertStatus(405);
    }
}

<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Models\DriveShare;
use App\Services\Drive\CollabDocFormats;
use App\Services\Drive\DriveSharePathScope;
use App\Services\Drive\DriveSharePresenter;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use Illuminate\Support\Carbon;
use Tests\TestCase;

final class DriveSharePresenterTest extends TestCase
{
    private DriveSharePresenter $presenter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->presenter = new DriveSharePresenter(
            new StoragePaths,
            new DriveSharePathScope(new StoragePaths),
            new CollabDocFormats,
            app(WgwStorage::class),
        );
    }

    public function test_share_lifecycle_active_when_not_expired(): void
    {
        $share = new DriveShare;
        $share->expires_at = null;
        $this->assertSame('active', $this->presenter->shareLifecycleStatus($share));
    }

    public function test_share_lifecycle_expired(): void
    {
        $share = new DriveShare;
        $share->expires_at = Carbon::now()->subMinute();
        $this->assertSame('expired', $this->presenter->shareLifecycleStatus($share));
    }

    public function test_is_share_live_false_when_revoked(): void
    {
        $share = new DriveShare;
        $share->revoked_at = Carbon::now();
        $this->assertFalse($this->presenter->isShareLive($share, Carbon::now()));
    }

    public function test_grant_source_marks_inherited(): void
    {
        $share = new DriveShare;
        $share->id = 'share-1';
        $share->path = '/users/alice/docs';
        $share->expires_at = null;

        $source = $this->presenter->grantSource($share, '/users/alice/docs/plan.md');
        $this->assertTrue($source['inherited']);
        $this->assertSame('share-1', $source['shareId']);
        $this->assertSame('/users/alice/docs', $source['sharePath']);
    }
}

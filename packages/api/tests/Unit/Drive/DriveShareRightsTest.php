<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Services\Drive\DriveShareAccess;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class DriveShareRightsTest extends TestCase
{
    /**
     * @return iterable<string, array{0: string, 1: bool, 2: bool, 3: bool, 4: bool, 5: bool}>
     */
    public static function rightsMatrixProvider(): iterable
    {
        yield 'view on markdown' => [DriveShareAccess::VIEW, true, false, false, false, false];
        yield 'comment on markdown' => [DriveShareAccess::COMMENT, true, true, false, false, false];
        // Legacy review matches edit effective rights (including mayEditContent).
        yield 'review on markdown' => [DriveShareAccess::REVIEW, true, true, true, true, false];
        yield 'edit on markdown' => [DriveShareAccess::EDIT, true, true, true, true, false];
        yield 'full on markdown' => [DriveShareAccess::FULL, true, true, true, true, true];
    }

    #[DataProvider('rightsMatrixProvider')]
    public function test_access_levels_map_to_expected_markdown_rights(
        string $access,
        bool $mayView,
        bool $mayComment,
        bool $mayReview,
        bool $mayEditContent,
        bool $mayManageStructure,
    ): void {
        $rights = DriveShareAccess::rightsFor($access, true);

        $this->assertSame($mayView, $rights['mayView']);
        $this->assertSame($mayComment, $rights['mayComment']);
        $this->assertSame($mayReview, $rights['mayReview']);
        $this->assertSame($mayEditContent, $rights['mayEditContent']);
        $this->assertSame($mayManageStructure, $rights['mayManageStructure']);
    }

    public function test_comment_grants_fallback_to_view_on_non_collab_files(): void
    {
        $commentRights = DriveShareAccess::rightsFor(DriveShareAccess::COMMENT, false);

        $this->assertTrue($commentRights['mayView']);
        $this->assertFalse($commentRights['mayComment']);
        $this->assertFalse($commentRights['mayReview']);
        $this->assertFalse($commentRights['mayEditContent']);
    }

    public function test_legacy_review_grants_match_edit_on_non_collab_files(): void
    {
        $reviewRights = DriveShareAccess::rightsFor(DriveShareAccess::REVIEW, false);
        $editRights = DriveShareAccess::rightsFor(DriveShareAccess::EDIT, false);

        $this->assertSame($editRights, $reviewRights);
        $this->assertTrue($reviewRights['mayEditContent']);
        $this->assertFalse($reviewRights['mayComment']);
        $this->assertFalse($reviewRights['mayReview']);
    }

    public function test_normalize_maps_review_to_edit(): void
    {
        $this->assertSame(DriveShareAccess::EDIT, DriveShareAccess::normalize('review'));
        $this->assertSame(DriveShareAccess::EDIT, DriveShareAccess::normalize('REVIEW'));
        $this->assertSame(DriveShareAccess::COMMENT, DriveShareAccess::normalize('comment'));
    }
}

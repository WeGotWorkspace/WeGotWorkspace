<?php

declare(strict_types=1);

namespace Tests\Unit\Drive;

use App\Exceptions\ApiHttpException;
use App\Services\Drive\CollabDocFormats;
use App\Services\Drive\DriveGroupResolver;
use App\Services\Drive\DriveShareAccess;
use App\Services\Drive\DriveSharePathScope;
use App\Services\Drive\DriveShareRules;
use App\Storage\StoragePaths;
use App\Storage\WgwStorage;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

final class DriveShareRulesTest extends TestCase
{
    private DriveShareRules $rules;

    protected function setUp(): void
    {
        parent::setUp();
        $this->rules = new DriveShareRules(
            new StoragePaths,
            new DriveSharePathScope(new StoragePaths),
            new DriveGroupResolver,
            new CollabDocFormats,
            app(WgwStorage::class),
        );
    }

    public function test_required_path_normalizes(): void
    {
        $this->assertSame('/users/alice/docs', $this->rules->requiredPath('/users/alice/docs'));
    }

    public function test_required_path_rejects_empty(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->requiredPath('  ');
    }

    /**
     * @return iterable<string, array{0: mixed, 1: string}>
     */
    public static function kindProvider(): iterable
    {
        yield 'member' => ['member', 'member'];
        yield 'public' => ['PUBLIC', 'public'];
        yield 'guest' => ['guest', 'guest'];
    }

    #[DataProvider('kindProvider')]
    public function test_normalize_kind(mixed $input, string $expected): void
    {
        $this->assertSame($expected, $this->rules->normalizeKind($input));
    }

    public function test_normalize_kind_rejects_invalid(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->normalizeKind('owner');
    }

    public function test_normalize_access_maps_legacy_review_to_edit(): void
    {
        $this->assertSame(DriveShareAccess::EDIT, $this->rules->normalizeAccess('review'));
    }

    public function test_normalize_access_rejects_unknown(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->normalizeAccess('admin');
    }

    public function test_assert_public_access_cap_allows_view(): void
    {
        $this->rules->assertPublicAccessCap('public', DriveShareAccess::VIEW);
        $this->addToAssertionCount(1);
    }

    public function test_assert_public_access_cap_rejects_edit(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->assertPublicAccessCap('public', DriveShareAccess::EDIT);
    }

    public function test_parse_group_principal_key(): void
    {
        $this->assertSame('eng', $this->rules->parseGroupPrincipalKey('groups/eng'));
        $this->assertNull($this->rules->parseGroupPrincipalKey('alice'));
    }

    public function test_assert_share_path_not_top_level_drive(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->assertSharePathNotTopLevelDrive('/users/alice');
    }

    public function test_note_path_access_rejects_full(): void
    {
        $this->expectException(ApiHttpException::class);
        $this->rules->assertNotePathAccessAllowed(DriveShareAccess::FULL);
    }

    public function test_note_listing_meta_from_note_file(): void
    {
        $meta = $this->rules->noteListingMetaFromPath('/users/alice/.notes/inbox/note-1.md');
        $this->assertNotNull($meta);
        $this->assertSame('note', $meta['kind']);
        $this->assertSame('note-1', $meta['id']);
    }

    public function test_note_listing_meta_from_notebook(): void
    {
        $meta = $this->rules->noteListingMetaFromPath('/users/alice/.notes/inbox');
        $this->assertNotNull($meta);
        $this->assertSame('notebook', $meta['kind']);
    }
}

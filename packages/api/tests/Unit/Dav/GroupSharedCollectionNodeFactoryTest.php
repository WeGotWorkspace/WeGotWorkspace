<?php

declare(strict_types=1);

namespace Tests\Unit\Dav;

use App\Dav\Server\GroupSharedCollection;
use App\Dav\Server\GroupSharedFile;
use App\Dav\Storage\FlysystemFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

final class GroupSharedCollectionNodeFactoryTest extends TestCase
{
    public function test_listing_then_get_child_uses_the_same_group_file_type(): void
    {
        Storage::fake('wgw_files');
        $filesystem = Storage::disk('wgw_files');
        $filesystem->makeDirectory('groups/team');
        $filesystem->put('groups/team/notes.txt', 'hello');
        $filesystem->makeDirectory('groups/team/subdir');
        $filesystem->put('groups/team/subdir/nested.txt', 'nested');

        $collection = new GroupSharedCollection(
            $filesystem,
            'groups/team',
            'principals/groups/team',
        );

        $listed = [];
        foreach ($collection->getChildren() as $child) {
            $listed[$child->getName()] = $child;
        }

        $this->assertArrayHasKey('notes.txt', $listed);
        $this->assertArrayHasKey('subdir', $listed);
        $this->assertSame(GroupSharedFile::class, $listed['notes.txt']::class);
        $this->assertNotSame(FlysystemFile::class, $listed['notes.txt']::class);
        $this->assertSame(GroupSharedCollection::class, $listed['subdir']::class);

        $openedFile = $collection->getChild('notes.txt');
        $openedDir = $collection->getChild('subdir');

        $this->assertSame(GroupSharedFile::class, $openedFile::class);
        $this->assertSame($listed['notes.txt']::class, $openedFile::class);
        $this->assertSame(GroupSharedCollection::class, $openedDir::class);
        $this->assertSame($listed['subdir']::class, $openedDir::class);
        $this->assertSame(GroupSharedFile::class, $listed['subdir']->getChild('nested.txt')::class);
    }
}

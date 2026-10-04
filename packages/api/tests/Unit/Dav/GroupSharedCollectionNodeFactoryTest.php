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
    public function test_get_child_and_get_children_return_the_same_concrete_types(): void
    {
        Storage::fake('wgw_files');
        $filesystem = Storage::disk('wgw_files');
        $filesystem->put('groups/team/notes.md', 'hello');
        $filesystem->makeDirectory('groups/team/folder');
        $filesystem->put('groups/team/folder/nested.md', 'nested');

        $collection = new GroupSharedCollection(
            $filesystem,
            'groups/team',
            'principals/groups/team',
        );

        $listed = [];
        foreach ($collection->getChildren() as $child) {
            $listed[$child->getName()] = $child;
        }

        $this->assertArrayHasKey('notes.md', $listed);
        $this->assertArrayHasKey('folder', $listed);
        $this->assertSame(GroupSharedFile::class, $listed['notes.md']::class);
        $this->assertSame(GroupSharedCollection::class, $listed['folder']::class);
        $this->assertNotSame(FlysystemFile::class, $listed['notes.md']::class);

        $openedFile = $collection->getChild('notes.md');
        $openedFolder = $collection->getChild('folder');
        $this->assertInstanceOf(GroupSharedFile::class, $openedFile);
        $this->assertInstanceOf(GroupSharedCollection::class, $openedFolder);
        $this->assertSame($listed['notes.md']::class, $openedFile::class);
        $this->assertSame($listed['folder']::class, $openedFolder::class);

        $this->assertInstanceOf(GroupSharedCollection::class, $openedFolder);
        $nestedListed = [];
        foreach ($openedFolder->getChildren() as $child) {
            $nestedListed[$child->getName()] = $child;
        }
        $this->assertInstanceOf(GroupSharedFile::class, $nestedListed['nested.md']);
        $this->assertSame(GroupSharedFile::class, $openedFolder->getChild('nested.md')::class);
    }
}

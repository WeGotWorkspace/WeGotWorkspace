<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\Server\GroupSharedCollection;
use App\Dav\Server\GroupSharedFile;
use App\Models\Principal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\Support\WgwDatabaseTestCase;

final class GroupSharedListingQueryTest extends WgwDatabaseTestCase
{
    public function test_listing_reuses_collection_acl_without_per_child_membership_queries(): void
    {
        $this->seedWgwUser('alice', displayName: 'Alice');
        $group = $this->seedWgwGroup('principals/groups/team', 'Team');
        $alice = Principal::forUsername('alice');
        $this->assertNotNull($alice);
        $this->addPrincipalToGroup($group, $alice);

        Storage::fake('wgw_files');
        $filesystem = Storage::disk('wgw_files');
        $filesystem->makeDirectory('groups/team');
        for ($i = 0; $i < 20; $i++) {
            $filesystem->put(sprintf('groups/team/file-%02d.txt', $i), 'x');
        }

        $collection = new GroupSharedCollection(
            $filesystem,
            'groups/team',
            'principals/groups/team',
        );
        $parentAcl = $collection->getACL();
        $this->assertSame('principals/alice', $parentAcl[1]['principal'] ?? null);

        DB::connection('wgw')->flushQueryLog();
        DB::connection('wgw')->enableQueryLog();

        $children = $collection->getChildren();
        $this->assertCount(20, $children);
        foreach ($children as $child) {
            $this->assertInstanceOf(GroupSharedFile::class, $child);
            $this->assertSame($parentAcl, $child->getACL());
        }

        $membershipQueries = 0;
        foreach (DB::connection('wgw')->getQueryLog() as $query) {
            $sql = strtolower((string) ($query['query'] ?? ''));
            if (str_contains($sql, 'groupmembers')) {
                $membershipQueries++;
            }
        }

        $this->assertSame(
            0,
            $membershipQueries,
            'Listed children must reuse the collection ACL instead of resolving membership per node',
        );
    }
}

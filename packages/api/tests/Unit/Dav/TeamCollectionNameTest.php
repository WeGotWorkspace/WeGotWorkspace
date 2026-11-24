<?php

declare(strict_types=1);

namespace Tests\Unit\Dav;

use App\Dav\Server\TeamCollectionName;
use PHPUnit\Framework\TestCase;

final class TeamCollectionNameTest extends TestCase
{
    public function test_a_name_parses_back_to_its_team_and_collection(): void
    {
        $name = TeamCollectionName::make('sales-eu', 'tasks-sales-eu');

        $this->assertSame('team~sales-eu~tasks-sales-eu', $name);
        $this->assertSame(['slug' => 'sales-eu', 'uri' => 'tasks-sales-eu'], TeamCollectionName::parse($name));
    }

    public function test_names_outside_the_prefix_or_without_both_parts_do_not_parse(): void
    {
        foreach (['default', 'team-x', 'team~', 'team~x', 'team~x~', 'team~~y'] as $name) {
            $this->assertNull(TeamCollectionName::parse($name), $name);
        }
    }

    public function test_a_member_home_path_maps_to_the_team_path(): void
    {
        $this->assertSame(
            'calendars/groups/t1/t1/standup.ics',
            TeamCollectionName::canonicalPath('calendars/bob/team~t1~t1/standup.ics'),
        );
        $this->assertSame(
            'addressbooks/groups/t1/default/a.vcf',
            TeamCollectionName::canonicalPath('/addressbooks/bob/team~t1~default/a.vcf/'),
        );
        $this->assertSame('calendars/bob/default/x.ics', TeamCollectionName::canonicalPath('calendars/bob/default/x.ics'));
        $this->assertSame('files/users/bob/team~t1~x', TeamCollectionName::canonicalPath('files/users/bob/team~t1~x'));
    }
}

<?php

declare(strict_types=1);

namespace Tests\Feature\Dav;

use App\Dav\Server\AppCalDAVPrincipalCollection;
use App\Dav\Server\AppCalendarRoot;
use Illuminate\Support\Facades\DB;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\DAV\Auth\Plugin as AuthPlugin;
use Sabre\DAVACL\PrincipalBackend\PDO as PrincipalPDO;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

final class CalDavPrincipalListingTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
    }

    public function test_listing_and_search_are_least_privilege_while_get_child_resolves_attendee(): void
    {
        $auth = $this->createMock(AuthPlugin::class);
        $auth->method('getCurrentPrincipal')->willReturn('principals/bob');
        $pdo = DB::connection('wgw')->getPdo();
        $principals = new PrincipalPDO($pdo);
        $collection = new AppCalDAVPrincipalCollection($principals, $auth);

        $listed = array_map(static fn ($node): string => $node->getName(), $collection->getChildren());
        $this->assertContains('bob', $listed);
        $this->assertNotContains('carol', $listed);

        $this->assertSame('carol', $collection->getChild('carol')->getName());

        $found = $collection->searchPrincipals([
            '{http://sabredav.org/ns}email-address' => 'carol@example.test',
        ]);
        $this->assertNotContains('carol', $found);

        $own = $collection->searchPrincipals([
            '{http://sabredav.org/ns}email-address' => 'bob@example.test',
        ]);
        $this->assertContains('bob', $own);

        $root = new AppCalendarRoot($principals, new CalPDO($pdo), $auth);
        $homes = array_map(static fn ($node): string => $node->getName(), $root->getChildren());
        $this->assertSame(['bob'], $homes);
        $this->assertSame('carol', $root->getChild('carol')->getName());
    }
}

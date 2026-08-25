<?php

declare(strict_types=1);

namespace Tests\Unit\Calendars;

use App\Models\Principal;
use App\Services\Calendars\CalendarPrincipalAddresses;
use Tests\Support\WgwDatabaseTestCase;

final class CalendarPrincipalAddressesTest extends WgwDatabaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');
        $this->seedWgwUser('wouter', email: 'wouter@woutervroege.nl', displayName: 'Wouter');
        $this->seedWgwUser('bare', displayName: 'Bare');
        $bare = Principal::forUsername('bare');
        $this->assertNotNull($bare);
        $bare->email = null;
        $bare->save();
    }

    public function test_accepts_localhost_email_and_username_aliases(): void
    {
        $addresses = app(CalendarPrincipalAddresses::class);

        $this->assertSame('admin@localhost', $addresses->normalizedEmail('mailto:admin@localhost'));
        $this->assertContains('mailto:admin@localhost', $addresses->addressesForUsername('admin'));
        $this->assertContains('mailto:admin', $addresses->addressesForUsername('admin'));
        $this->assertContains('mailto:bare', $addresses->addressesForUsername('bare'));
    }

    public function test_resolves_local_attendee_by_email_or_username(): void
    {
        $addresses = app(CalendarPrincipalAddresses::class);

        $this->assertSame('principals/wouter', $addresses->principalForMailto('mailto:wouter@woutervroege.nl')?->uri);
        $this->assertSame('principals/wouter', $addresses->principalForMailto('mailto:wouter')?->uri);
        $this->assertSame('principals/admin', $addresses->principalForMailto('admin@localhost')?->uri);
        $this->assertSame('principals/admin', $addresses->principalForMailto('admin')?->uri);
        $this->assertSame('principals/bare', $addresses->principalForMailto('bare')?->uri);
        $this->assertNull($addresses->principalForMailto('mailto:guest@elsewhere.test'));
    }

    public function test_resolves_principal_by_stored_invalid_or_empty_email(): void
    {
        $broken = Principal::forUsername('admin');
        $this->assertNotNull($broken);
        $broken->email = 'not-an-email';
        $broken->save();

        $addresses = app(CalendarPrincipalAddresses::class);

        $this->assertSame('principals/admin', $addresses->principalForMailto('not-an-email')?->uri);
        $this->assertSame('principals/admin', $addresses->principalForMailto('mailto:not-an-email')?->uri);
        $this->assertSame('principals/admin', $addresses->principalForMailto('admin')?->uri);
        $this->assertSame('admin', $addresses->canonicalCalendarUserAddress($broken));
        $bare = Principal::forUsername('bare');
        $this->assertNotNull($bare);
        $this->assertSame('bare', $addresses->canonicalCalendarUserAddress($bare));
    }

    public function test_share_href_and_jmap_id_for_users_and_groups(): void
    {
        $team = Principal::factory()->forGroup('team', 'Team')->create();
        $addresses = app(CalendarPrincipalAddresses::class);
        $wouter = Principal::forUsername('wouter');
        $this->assertNotNull($wouter);

        $this->assertSame('mailto:wouter@woutervroege.nl', $addresses->shareHrefForPrincipal($wouter));
        $this->assertSame('mailto:groups/team', $addresses->shareHrefForPrincipal($team));
        $this->assertSame('wouter', $addresses->jmapIdForPrincipalUri((string) $wouter->uri));
        $this->assertSame('groups/team', $addresses->jmapIdForPrincipalUri((string) $team->uri));
        $this->assertSame('principals/wouter', $addresses->principalForJmapId('wouter')?->uri);
        $this->assertSame('principals/groups/team', $addresses->principalForJmapId('groups/team')?->uri);
        $this->assertSame('groups/team', $addresses->jmapIdForShareHref('mailto:groups/team'));
    }
}

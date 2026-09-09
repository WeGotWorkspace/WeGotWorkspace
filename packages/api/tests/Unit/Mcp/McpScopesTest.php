<?php

declare(strict_types=1);

namespace Tests\Unit\Mcp;

use App\Services\Mcp\McpScopes;
use PHPUnit\Framework\TestCase;

final class McpScopesTest extends TestCase
{
    public function test_advertised_ids_include_per_app_read_and_write(): void
    {
        $ids = McpScopes::ids();
        foreach ([
            'calendar.read', 'calendar.write',
            'notes.read', 'notes.write',
            'contacts.read', 'contacts.write',
            'tasks.read', 'tasks.write',
            'docs.read', 'docs.write',
            'drive.read', 'drive.write',
            'meet.read', 'meet.write',
            'mail.read', 'mail.send',
            'settings', 'offline_access',
        ] as $scope) {
            $this->assertContains($scope, $ids);
        }
        $this->assertNotContains('calendar', $ids);
        $this->assertNotContains('docs', $ids);
    }

    public function test_client_allowlist_keeps_advertised_and_legacy_ids(): void
    {
        $allow = McpScopes::clientAllowlist();
        $this->assertContains('calendar.read', $allow);
        $this->assertContains('calendar.write', $allow);
        $this->assertContains('calendar', $allow);
        $this->assertContains('docs', $allow);
        $this->assertContains('mail.read', $allow);
    }

    public function test_descriptions_drop_manage_wording(): void
    {
        foreach (McpScopes::advertisedDescriptions() as $id => $copy) {
            $this->assertStringNotContainsStringIgnoringCase('manage', $copy, $id);
        }
    }

    public function test_read_scope_does_not_satisfy_write(): void
    {
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::CALENDAR_READ], McpScopes::CALENDAR_READ));
        $this->assertFalse(McpScopes::grantedSatisfies([McpScopes::CALENDAR_READ], McpScopes::CALENDAR_WRITE));
        $this->assertFalse(McpScopes::grantedSatisfies([McpScopes::DRIVE_WRITE], McpScopes::DRIVE_READ));
    }

    public function test_legacy_aliases_satisfy_read_and_write(): void
    {
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::CALENDAR], McpScopes::CALENDAR_READ));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::CALENDAR], McpScopes::CALENDAR_WRITE));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::DRIVE], McpScopes::DRIVE_READ));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::TASKS], McpScopes::TASKS_WRITE));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::CONTACTS], McpScopes::CONTACTS_READ));
    }

    public function test_legacy_docs_covers_docs_and_notes_but_docs_read_does_not(): void
    {
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::DOCS], McpScopes::NOTES_READ));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::DOCS], McpScopes::NOTES_WRITE));
        $this->assertTrue(McpScopes::grantedSatisfies([McpScopes::DOCS], McpScopes::DOCS_READ));
        $this->assertFalse(McpScopes::grantedSatisfies([McpScopes::DOCS_READ], McpScopes::NOTES_READ));
        $this->assertFalse(McpScopes::grantedSatisfies([McpScopes::NOTES_READ], McpScopes::DOCS_READ));
    }

    public function test_consent_groups_read_and_write_by_app(): void
    {
        $scopes = array_map(
            static fn (string $id): object => (object) ['id' => $id, 'description' => $id],
            [McpScopes::CALENDAR_READ, McpScopes::CALENDAR_WRITE, McpScopes::SETTINGS, McpScopes::CALENDAR],
        );
        $groups = McpScopes::groupConsentScopes($scopes);
        $labels = array_column($groups, 'label');
        $this->assertSame(['Calendar', 'Profile'], $labels);
        $calendarIds = array_map(
            static fn (object $scope): string => $scope->id,
            $groups[0]['scopes'],
        );
        $this->assertSame(
            [McpScopes::CALENDAR_READ, McpScopes::CALENDAR_WRITE, McpScopes::CALENDAR],
            $calendarIds,
        );
    }

    public function test_group_consent_scopes_hides_offline_access(): void
    {
        $scopes = array_map(
            static fn (string $id): object => (object) ['id' => $id, 'description' => $id],
            [McpScopes::DRIVE_READ, McpScopes::OFFLINE_ACCESS, McpScopes::SETTINGS],
        );
        $groups = McpScopes::groupConsentScopes($scopes);
        $this->assertSame(['Drive', 'Profile'], array_column($groups, 'label'));
        $ids = [];
        foreach ($groups as $group) {
            foreach ($group['scopes'] as $scope) {
                $ids[] = $scope->id;
            }
        }
        $this->assertNotContains(McpScopes::OFFLINE_ACCESS, $ids);
        $this->assertSame(
            [McpScopes::DRIVE_READ, McpScopes::SETTINGS],
            McpScopes::userFacingIds([McpScopes::DRIVE_READ, McpScopes::OFFLINE_ACCESS, McpScopes::SETTINGS]),
        );
    }

    public function test_consent_action_labels_are_read_write_or_send(): void
    {
        $this->assertSame('Read', McpScopes::consentActionLabel(McpScopes::CALENDAR_READ));
        $this->assertSame('Write', McpScopes::consentActionLabel(McpScopes::CALENDAR_WRITE));
        $this->assertSame('Send', McpScopes::consentActionLabel(McpScopes::MAIL_SEND));
        $this->assertSame('Read', McpScopes::consentActionLabel(McpScopes::SETTINGS));
        $this->assertSame('Stay connected', McpScopes::consentActionLabel(McpScopes::OFFLINE_ACCESS));
        $this->assertSame('Read and write', McpScopes::consentActionLabel(McpScopes::CALENDAR));
        $this->assertSame('Read', McpScopes::consentActionLabel(McpScopes::NOTES_READ));
        $this->assertSame('Write', McpScopes::consentActionLabel(McpScopes::DRIVE_WRITE));
        $this->assertSame('calendar', McpScopes::consentAppIcon('Calendar'));
        $this->assertSame('settings', McpScopes::consentAppIcon('Profile'));
        $this->assertNull(McpScopes::consentAppIcon('Connection'));
    }
}

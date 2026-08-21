<?php

declare(strict_types=1);

namespace Tests\Feature\Calendars;

use App\Models\CalendarObject;
use App\Models\Principal;
use App\Models\SchedulingObject;
use App\Services\Jmap\JmapCapabilities;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Testing\TestResponse;
use Sabre\CalDAV\Backend\PDO as CalPDO;
use Sabre\CalDAV\Xml\Property\SupportedCalendarComponentSet;
use Tests\Support\CalendarsTestFixtures;
use Tests\Support\WgwDatabaseTestCase;

/**
 * Scheduling inbox REST (Task #484): list, RSVP, dismiss, cross-user 404.
 */
final class CalendarsSchedulingNotificationsTest extends WgwDatabaseTestCase
{
    use CalendarsTestFixtures;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpCalendarsFixtures();
        Mail::fake();
    }

    public function test_invitees_lists_instance_users_with_email(): void
    {
        $body = $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/invitees')
            ->assertOk()
            ->assertJsonStructure(['list', 'canSubmitEmail']);
        $this->assertIsBool($body->json('canSubmitEmail'));
        $list = $body->json('list');

        $this->assertIsArray($list);
        $emails = array_map(static fn (array $row): string => (string) $row['email'], $list);
        $this->assertContains('bob@example.test', $emails);
        $this->assertContains('carol@example.test', $emails);
    }

    public function test_invitees_include_localhost_email_and_username_only_users(): void
    {
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');
        $this->seedWgwUser('bare', displayName: 'Bare');
        $bare = Principal::forUsername('bare');
        $this->assertNotNull($bare);
        $bare->email = null;
        $bare->save();

        $list = $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/invitees')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $byUsername = [];
        foreach ($list as $row) {
            $byUsername[(string) $row['username']] = (string) $row['email'];
        }
        $this->assertSame('admin@localhost', $byUsername['admin'] ?? null);
        $this->assertSame('bare', $byUsername['bare'] ?? null);
    }

    public function test_duplicate_request_copies_for_same_uid_list_as_one_notification(): void
    {
        $uid = 'dup-invite-uid';
        $this->insertSchedulingObject(
            'principals/carol',
            'req-1.ics',
            $this->inviteIcs($uid, '20300115T114500Z', '20300115T121500Z'),
        );
        $this->insertSchedulingObject(
            'principals/carol',
            'req-2.ics',
            $this->inviteIcs($uid, '20300115T124500Z', '20300115T131500Z'),
        );
        $this->insertSchedulingObject(
            'principals/carol',
            'req-3.ics',
            $this->inviteIcs($uid, '20300115T134500Z', '20300115T141500Z'),
        );

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');

        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame($uid, $list[0]['uid']);
        $this->assertSame('2030-01-15T13:45:00Z', $list[0]['start']);
        $this->assertSame(
            1,
            SchedulingObject::query()->where('principaluri', 'principals/carol')->count(),
        );
    }

    public function test_recurring_series_lists_one_card_not_each_occurrence(): void
    {
        $uid = 'series-invite-uid';
        $this->insertSchedulingObject(
            'principals/carol',
            'series-master.ics',
            $this->inviteIcs($uid, '20300115T100000Z', '20300115T110000Z', 'FREQ=DAILY;COUNT=3'),
        );
        $this->insertSchedulingObject(
            'principals/carol',
            'series-instance.ics',
            $this->inviteIcs($uid, '20300116T100000Z', '20300116T110000Z'),
        );

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');

        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame($uid, $list[0]['uid']);
    }

    public function test_attendee_lists_own_invite_notification(): void
    {
        $this->bobInvitesCarol();

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');

        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('REQUEST', $list[0]['method']);
        $this->assertSame('Standup', $list[0]['title']);
        $this->assertSame('bob@example.test', $list[0]['organizerEmail']);
        $this->assertSame('needs-action', $list[0]['participationStatus']);
        $this->assertNotSame('', $list[0]['id']);
        $this->assertNotSame('', $list[0]['uid']);
        $this->assertNotNull($list[0]['eventId']);
    }

    public function test_respond_accepted_updates_organizer_and_keeps_inbox(): void
    {
        $eventId = $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list.0.participationStatus', 'accepted')
            ->assertJsonPath('list.0.method', 'REQUEST');

        $bobEvent = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ($bobEvent['participants'] ?? [] as $participant) {
            if (($participant['email'] ?? '') === 'carol@example.test') {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? ''));
            }
        }
        $this->assertContains('accepted', $partstats);
        Mail::assertNothingSent();
    }

    public function test_respond_accepted_moves_copy_to_selected_calendar(): void
    {
        $this->bobInvitesCarol();
        $this->seedCalendarFor('carol', 'work', 'Work');
        $notificationId = $this->carolNotificationId();
        $eventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted', 'calendarId' => 'work'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertTrue($carolEvent['calendarIds']['work'] ?? false);
        $this->assertFalse($carolEvent['calendarIds']['default'] ?? false);
    }

    public function test_respond_can_move_already_accepted_copy(): void
    {
        $this->bobInvitesCarol();
        $this->seedCalendarFor('carol', 'work', 'Work');
        $this->seedCalendarFor('carol', 'home', 'Home');
        $notificationId = $this->carolNotificationId();
        $eventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted', 'calendarId' => 'work'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted', 'calendarId' => 'home'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertTrue($carolEvent['calendarIds']['home'] ?? false);
        $this->assertFalse($carolEvent['calendarIds']['work'] ?? false);
    }

    public function test_respond_declined_ignores_calendar_id(): void
    {
        $this->bobInvitesCarol();
        $this->seedCalendarFor('carol', 'work', 'Work');
        $notificationId = $this->carolNotificationId();
        $eventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'declined', 'calendarId' => 'work'],
        )->assertOk()->assertJsonPath('participationStatus', 'declined');

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertTrue($carolEvent['calendarIds']['default'] ?? false);
        $this->assertFalse($carolEvent['calendarIds']['work'] ?? false);
    }

    public function test_dismiss_removes_inbox_without_reply(): void
    {
        $eventId = $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('carol')->deleteJson('/api/v1/calendars/scheduling/notifications/'.$notificationId)
            ->assertNoContent();

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);

        $bobEvent = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $partstats = [];
        foreach ($bobEvent['participants'] ?? [] as $participant) {
            if (($participant['email'] ?? '') === 'carol@example.test') {
                $partstats[] = strtolower((string) ($participant['participationStatus'] ?? 'needs-action'));
            }
        }
        $this->assertContains('needs-action', $partstats);
    }

    public function test_organizer_does_not_list_own_request_when_inviting(): void
    {
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');
        $this->seedWgwUser('wouter', email: 'wouter@example.test', displayName: 'Wouter');
        $this->seedDefaultCalendarFor('admin');
        $this->seedDefaultCalendarFor('wouter');

        $created = $this->jmapAs('admin', [
            ['CalendarEvent/set', ['accountId' => 'admin', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Uit eten',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'admin@localhost',
                        'name' => 'Admin',
                        'roles' => ['owner' => true],
                    ],
                    'self' => [
                        '@type' => 'Participant',
                        'email' => 'admin',
                        'name' => 'Admin',
                        'roles' => ['attendee' => true],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'wouter@example.test',
                        'name' => 'Wouter',
                        'roles' => ['attendee' => true],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);
        $uid = (string) $this->jmapAs('admin', [
            ['CalendarEvent/get', ['accountId' => 'admin', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0.uid');
        $this->assertNotSame('', $uid);

        $adminList = $this->asUser('admin')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($adminList);
        $adminRequests = array_values(array_filter(
            $adminList,
            static fn (array $row): bool => ($row['method'] ?? '') === 'REQUEST' && ($row['uid'] ?? '') === $uid,
        ));
        $this->assertSame([], $adminRequests);

        $wouterList = $this->asUser('wouter')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($wouterList);
        $wouterRequests = array_values(array_filter(
            $wouterList,
            static fn (array $row): bool => ($row['method'] ?? '') === 'REQUEST' && ($row['uid'] ?? '') === $uid,
        ));
        $this->assertCount(1, $wouterRequests);
    }

    public function test_organizer_inbox_omits_outbound_request_keeps_reply(): void
    {
        $this->seedWgwUser('admin', email: 'admin@localhost', displayName: 'Admin');

        $this->insertSchedulingObject(
            'principals/admin',
            'outbound-request.ics',
            $this->schedulingIcs('REQUEST', 'outbound-uid', 'admin@localhost', 'wouter@example.test', 'NEEDS-ACTION'),
        );
        $this->insertSchedulingObject(
            'principals/admin',
            'attendee-reply.ics',
            $this->schedulingIcs('REPLY', 'reply-uid', 'admin@localhost', 'wouter@example.test', 'ACCEPTED'),
        );
        $this->insertSchedulingObject(
            'principals/admin',
            'attendee-cancel.ics',
            $this->schedulingIcs('CANCEL', 'cancel-uid', 'admin@localhost', 'wouter@example.test', 'DECLINED'),
        );

        $list = $this->asUser('admin')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $byMethod = [];
        foreach ($list as $row) {
            $byMethod[(string) $row['method']][] = (string) $row['uid'];
        }
        $this->assertArrayNotHasKey('REQUEST', $byMethod);
        $this->assertArrayNotHasKey('REPLY', $byMethod);
        $this->assertArrayNotHasKey('CANCEL', $byMethod);
        $this->assertSame([], $list);
    }

    public function test_respond_can_change_existing_partstat(): void
    {
        $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk()->assertJsonPath('participationStatus', 'accepted');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'declined'],
        )->assertOk()->assertJsonPath('participationStatus', 'declined');

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list.0.participationStatus', 'declined');
    }

    public function test_respond_this_instance_writes_recurrence_id_exception(): void
    {
        $eventId = $this->bobInvitesCarolWeekly();
        $notificationId = $this->carolNotificationId();
        $carolEventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            [
                'participationStatus' => 'declined',
                'scope' => 'this',
                'recurrenceId' => '2030-01-22T10:00:00Z',
            ],
        )->assertOk();

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$carolEventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame('accepted', $this->participantPartstat($carolEvent, 'carol@example.test'));
        $this->assertSame(
            'declined',
            $this->overridePartstat($carolEvent, '2030-01-22T10:00:00Z', 'carol@example.test'),
        );

        $bobEvent = $this->jmapAs('bob', [
            ['CalendarEvent/get', ['accountId' => 'bob', 'ids' => [$eventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');
        $this->assertSame('accepted', $this->participantPartstat($bobEvent, 'carol@example.test'));
        $this->assertSame(
            'declined',
            $this->overridePartstat($bobEvent, '2030-01-22T10:00:00Z', 'carol@example.test'),
        );

        $carolCopy = $this->findCarolCopyIcs((string) ($carolEvent['uid'] ?? ''));
        $this->assertStringContainsString('RECURRENCE-ID:20300122T100000Z', $carolCopy);
        $unfolded = str_replace("\r\n ", '', $carolCopy);
        $this->assertMatchesRegularExpression(
            '/BEGIN:VEVENT[\s\S]*?PARTSTAT=ACCEPTED[\s\S]*?END:VEVENT[\s\S]*?BEGIN:VEVENT[\s\S]*?PARTSTAT=DECLINED[\s\S]*?RECURRENCE-ID:20300122T100000Z[\s\S]*?END:VEVENT/i',
            $unfolded,
        );
    }

    public function test_respond_future_applies_from_instance_forward(): void
    {
        $this->bobInvitesCarolWeekly();
        $notificationId = $this->carolNotificationId();
        $carolEventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            [
                'participationStatus' => 'declined',
                'scope' => 'future',
                'recurrenceId' => '2030-01-22T10:00:00Z',
            ],
        )->assertOk();

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$carolEventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame('declined', $this->participantPartstat($carolEvent, 'carol@example.test'));
        $this->assertSame(
            'accepted',
            $this->overridePartstat($carolEvent, '2030-01-15T10:00:00Z', 'carol@example.test'),
        );
        $this->assertNull($this->overridePartstat($carolEvent, '2030-01-22T10:00:00Z', 'carol@example.test'));
    }

    public function test_respond_series_decline_rewrites_instance_partstat_overrides(): void
    {
        $this->bobInvitesCarolWeekly();
        $notificationId = $this->carolNotificationId();
        $carolEventId = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.eventId');

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertOk();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            [
                'participationStatus' => 'tentative',
                'scope' => 'this',
                'recurrenceId' => '2030-01-22T10:00:00Z',
            ],
        )->assertOk();

        $this->asUser('carol')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'declined'],
        )->assertOk()->assertJsonPath('participationStatus', 'declined');

        $carolEvent = $this->jmapAs('carol', [
            ['CalendarEvent/get', ['accountId' => 'carol', 'ids' => [$carolEventId]], 'c0'],
        ])->assertOk()->json('methodResponses.0.1.list.0');

        $this->assertSame('declined', $this->participantPartstat($carolEvent, 'carol@example.test'));
        $override = $this->overridePartstat($carolEvent, '2030-01-22T10:00:00Z', 'carol@example.test');
        $this->assertTrue(
            $override === 'declined' || $override === null,
            'Series decline must not leave a non-declined instance PARTSTAT (got '.var_export($override, true).')',
        );

        $carolCopy = $this->findCarolCopyIcs((string) ($carolEvent['uid'] ?? ''));
        $unfolded = str_replace("\r\n ", '', $carolCopy);
        $this->assertDoesNotMatchRegularExpression(
            '/PARTSTAT=(ACCEPTED|NEEDS-ACTION|TENTATIVE):mailto:carol@example.test/i',
            $unfolded,
        );
    }

    public function test_organizer_cancel_removes_attendee_notification(): void
    {
        $eventId = $this->bobInvitesCarol();
        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'list');

        $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'destroy' => [$eventId]], 'c0'],
        ])->assertOk();

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_missing_organizer_property_does_not_list_own_event(): void
    {
        $this->insertSchedulingObject(
            'principals/bob',
            'no-organizer.ics',
            "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\n"
            ."BEGIN:VEVENT\r\nUID:own-no-org\r\nSUMMARY:Standup\r\n"
            ."DTSTART:20300115T100000Z\r\nDTEND:20300115T103000Z\r\n"
            ."ATTENDEE;CN=Carol;PARTSTAT=NEEDS-ACTION:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n",
        );

        $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_past_one_off_invite_is_omitted_from_inbox(): void
    {
        $this->insertSchedulingObject(
            'principals/carol',
            'past-oneoff.ics',
            $this->inviteIcs('past-oneoff', '20200115T100000Z', '20200115T103000Z'),
        );

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_future_one_off_invite_is_listed(): void
    {
        $this->insertSchedulingObject(
            'principals/carol',
            'future-oneoff.ics',
            $this->inviteIcs('future-oneoff', '20300115T100000Z', '20300115T103000Z'),
        );

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('future-oneoff', $list[0]['uid']);
    }

    public function test_recurring_invite_with_future_instances_is_listed(): void
    {
        $this->insertSchedulingObject(
            'principals/carol',
            'series-open.ics',
            $this->inviteIcs(
                'series-open',
                '20200115T100000Z',
                '20200115T103000Z',
                'FREQ=WEEKLY;UNTIL=20301231T100000Z',
            ),
        );

        $list = $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list');
        $this->assertIsArray($list);
        $this->assertCount(1, $list);
        $this->assertSame('series-open', $list[0]['uid']);
        $this->assertTrue($list[0]['recurring']);
    }

    public function test_recurring_invite_with_no_remaining_instances_is_omitted(): void
    {
        $this->insertSchedulingObject(
            'principals/carol',
            'series-ended.ics',
            $this->inviteIcs(
                'series-ended',
                '20200115T100000Z',
                '20200115T103000Z',
                'FREQ=WEEKLY;COUNT=3',
            ),
        );

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_responded_past_invite_is_omitted_from_inbox(): void
    {
        $this->insertSchedulingObject(
            'principals/carol',
            'past-accepted.ics',
            $this->inviteIcs('past-accepted', '20200115T100000Z', '20200115T103000Z', partstat: 'ACCEPTED'),
        );

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);
    }

    public function test_other_users_notification_id_is_not_found(): void
    {
        $this->bobInvitesCarol();
        $notificationId = $this->carolNotificationId();

        $this->asUser('bob')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonPath('list', []);

        $this->asUser('bob')->postJson(
            '/api/v1/calendars/scheduling/notifications/'.$notificationId.'/respond',
            ['participationStatus' => 'accepted'],
        )->assertNotFound();

        $this->asUser('bob')->deleteJson('/api/v1/calendars/scheduling/notifications/'.$notificationId)
            ->assertNotFound();

        $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->assertJsonCount(1, 'list');
    }

    /**
     * @param  list<array{0: string, 1: array<string, mixed>, 2: string}>  $methodCalls
     */
    private function jmapAs(string $username, array $methodCalls): TestResponse
    {
        return $this->asUser($username)->postJson('/api/v1/jmap', [
            'using' => [JmapCapabilities::CORE, JmapCapabilities::CALENDARS],
            'methodCalls' => $methodCalls,
        ]);
    }

    private function asUser(string $username): self
    {
        $token = $username === 'bob'
            ? $this->userBearerToken()
            : $this->issueBearerTokenFor($username);

        return $this->withBearer($token);
    }

    private function bobInvitesCarolWeekly(): string
    {
        $created = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Weekly Standup',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'recurrenceRules' => [
                    ['@type' => 'RecurrenceRule', 'frequency' => 'weekly', 'byDay' => ['TU']],
                ],
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'name' => 'Bob',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'name' => 'Carol',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);

        return $eventId;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function participantPartstat(array $event, string $email): ?string
    {
        foreach ($event['participants'] ?? [] as $participant) {
            if (! is_array($participant)) {
                continue;
            }
            if (strtolower((string) ($participant['email'] ?? '')) !== strtolower($email)) {
                continue;
            }

            return strtolower((string) ($participant['participationStatus'] ?? ''));
        }

        return null;
    }

    /**
     * @param  array<string, mixed>  $event
     */
    private function overridePartstat(array $event, string $recurrenceId, string $email): ?string
    {
        $overrides = $event['recurrenceOverrides'] ?? [];
        if (! is_array($overrides) || ! isset($overrides[$recurrenceId]) || ! is_array($overrides[$recurrenceId])) {
            return null;
        }

        return $this->participantPartstat($overrides[$recurrenceId], $email);
    }

    private function findCarolCopyIcs(string $uid): string
    {
        $copy = CalendarObject::query()
            ->where('uid', $uid)
            ->whereHas('calendar.instances', function ($query): void {
                $query->where('principaluri', 'principals/carol');
            })
            ->first();
        $this->assertNotNull($copy);

        return is_string($copy->calendardata) ? $copy->calendardata : (string) $copy->calendardata;
    }

    private function bobInvitesCarol(): string
    {
        $created = $this->jmapAs('bob', [
            ['CalendarEvent/set', ['accountId' => 'bob', 'create' => ['inv' => [
                'calendarIds' => ['default' => true],
                'title' => 'Standup',
                'start' => '2030-01-15T10:00:00Z',
                'end' => '2030-01-15T10:30:00Z',
                'participants' => [
                    'org' => [
                        '@type' => 'Participant',
                        'email' => 'bob@example.test',
                        'name' => 'Bob',
                        'roles' => ['owner'],
                    ],
                    'att1' => [
                        '@type' => 'Participant',
                        'email' => 'carol@example.test',
                        'name' => 'Carol',
                        'roles' => ['attendee'],
                        'expectReply' => true,
                        'participationStatus' => 'needs-action',
                    ],
                ],
            ]]], 'c0'],
        ])->assertOk();

        $eventId = (string) $created->json('methodResponses.0.1.created.inv.id');
        $this->assertNotSame('', $eventId);

        return $eventId;
    }

    private function carolNotificationId(): string
    {
        $id = (string) $this->asUser('carol')->getJson('/api/v1/calendars/scheduling/notifications')
            ->assertOk()
            ->json('list.0.id');
        $this->assertNotSame('', $id);

        return $id;
    }

    private function seedCalendarFor(string $username, string $uri, string $displayName): void
    {
        $caldav = new CalPDO(DB::connection('wgw')->getPdo());
        $caldav->createCalendar('principals/'.$username, $uri, [
            '{DAV:}displayname' => $displayName,
            '{urn:ietf:params:xml:ns:caldav}supported-calendar-component-set' => new SupportedCalendarComponentSet(['VEVENT', 'VJOURNAL']),
        ]);
    }

    private function insertSchedulingObject(string $principalUri, string $uri, string $ics): void
    {
        SchedulingObject::query()->create([
            'principaluri' => $principalUri,
            'uri' => $uri,
            'calendardata' => $ics,
            'lastmodified' => time(),
            'etag' => md5($ics),
            'size' => strlen($ics),
        ]);
    }

    private function inviteIcs(
        string $uid,
        string $dtstart,
        string $dtend,
        ?string $rrule = null,
        string $partstat = 'NEEDS-ACTION',
    ): string {
        $rruleLine = $rrule !== null ? "RRULE:{$rrule}\r\n" : '';

        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Invite\r\n"
            ."DTSTART:{$dtstart}\r\nDTEND:{$dtend}\r\n{$rruleLine}"
            ."ORGANIZER;CN=Ext:mailto:ext@elsewhere.test\r\n"
            ."ATTENDEE;CN=Carol;PARTSTAT={$partstat}:mailto:carol@example.test\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function schedulingIcs(
        string $method,
        string $uid,
        string $organizerEmail,
        string $attendeeEmail,
        string $partstat,
    ): string {
        return "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:{$method}\r\n"
            ."BEGIN:VEVENT\r\nUID:{$uid}\r\nSUMMARY:Uit eten\r\n"
            ."DTSTART:20300115T100000Z\r\nDTEND:20300115T103000Z\r\n"
            ."ORGANIZER;CN=Admin:mailto:{$organizerEmail}\r\n"
            ."ATTENDEE;CN=Wouter;PARTSTAT={$partstat}:mailto:{$attendeeEmail}\r\n"
            ."END:VEVENT\r\nEND:VCALENDAR\r\n";
    }
}

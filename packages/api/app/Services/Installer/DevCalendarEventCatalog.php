<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Services\Calendars\CalendarCollectionUris;
use DateInterval;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Deterministic JMAP CalendarEvent payloads for local-dev calendar seeding.
 *
 * @phpstan-type SeedEvent array{calendarUri: string, objectUri: string, event: array<string, mixed>}
 */
final class DevCalendarEventCatalog
{
    public const PROFILE_FULL = 'full';

    public const PROFILE_COMPACT = 'compact';

    public const URI_PREFIX = 'dev-seed-';

    public const FULL_TARGET = 360;

    /** @var list<string> */
    public const EVENT_CALENDAR_URIS = [
        CalendarCollectionUris::EVENT_DEFAULT,
        CalendarCollectionUris::EVENT_HOME,
        CalendarCollectionUris::EVENT_WORK,
    ];

    private int $nextIndex = 1;

    /**
     * @return list<SeedEvent>
     */
    public function events(string $profile, DateTimeImmutable $now): array
    {
        $this->nextIndex = 1;
        $anchor = $this->mondayNine($now);
        $out = $this->representativeEvents($anchor);

        if ($profile === self::PROFILE_FULL) {
            $out = array_merge($out, $this->bulkEvents($anchor, count($out)));
        }

        return $out;
    }

    /**
     * @return list<SeedEvent>
     */
    private function representativeEvents(DateTimeImmutable $monday): array
    {
        $out = [];

        $this->add($out, CalendarCollectionUris::EVENT_WORK, [
            'title' => 'Daily standup',
            'description' => 'Engineering standup — one late, one cancelled.',
            'start' => $this->utc($monday),
            'end' => $this->utc($monday->add(new DateInterval('PT30M'))),
            'recurrenceRules' => [$this->weeklyRule(['mo', 'tu', 'we', 'th', 'fr'])],
            'excludedRecurrenceDates' => [$this->utc($monday->add(new DateInterval('P7D')))],
            'recurrenceOverrides' => [
                $this->utc($monday->add(new DateInterval('P14D'))) => [
                    'start' => $this->utc($monday->add(new DateInterval('P14DT5H'))),
                    'end' => $this->utc($monday->add(new DateInterval('P14DT5H30M'))),
                    'title' => 'Daily standup (late)',
                ],
                $this->utc($monday->add(new DateInterval('P21D'))) => [
                    'excluded' => true,
                ],
            ],
            'alerts' => [$this->relativeAlert('-PT15M')],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_WORK, [
            'title' => 'Weekly team sync',
            'start' => $this->utc($monday->setTime(11, 0)),
            'end' => $this->utc($monday->setTime(12, 0)),
            'recurrenceRules' => [$this->weeklyRule(['mo'])],
            'alerts' => [$this->relativeAlert('-PT1H')],
            'locations' => [
                'room' => ['@type' => 'Location', 'name' => 'Room A'],
            ],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_WORK, [
            'title' => 'Design review',
            'start' => $this->utc($monday->setTime(10, 0)),
            'end' => $this->utc($monday->setTime(11, 0)),
            'status' => 'confirmed',
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_WORK, [
            'title' => 'Customer call (overlap)',
            'start' => $this->utc($monday->setTime(10, 30)),
            'end' => $this->utc($monday->setTime(11, 30)),
            'status' => 'tentative',
            'freeBusyStatus' => 'tentative',
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_WORK, [
            'title' => 'Sprint retro',
            'start' => $this->utc($monday->setTime(15, 0)),
            'end' => $this->utc($monday->setTime(16, 0)),
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'monthly',
                'byDay' => [['@type' => 'NDay', 'day' => 'fr', 'nthOfPeriod' => -1]],
            ]],
        ]);

        $birthday = $monday->setDate((int) $monday->format('Y'), 8, 21)->setTime(0, 0);
        $this->add($out, CalendarCollectionUris::EVENT_HOME, [
            'title' => 'Ada birthday',
            'start' => $birthday->format('Y-m-d'),
            'end' => $birthday->add(new DateInterval('P1D'))->format('Y-m-d'),
            'showWithoutTime' => true,
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'yearly',
            ]],
            'alerts' => [$this->relativeAlert('-P1D')],
        ]);

        $tripStart = $monday->add(new DateInterval('P4D'))->setTime(0, 0);
        $this->add($out, CalendarCollectionUris::EVENT_HOME, [
            'title' => 'Weekend trip',
            'start' => $tripStart->format('Y-m-d'),
            'end' => $tripStart->add(new DateInterval('P3D'))->format('Y-m-d'),
            'showWithoutTime' => true,
            'freeBusyStatus' => 'free',
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_HOME, [
            'title' => 'Yoga',
            'start' => $this->utc($monday->setTime(18, 30)),
            'end' => $this->utc($monday->setTime(19, 30)),
            'recurrenceRules' => [$this->weeklyRule(['we'])],
            'alerts' => [$this->relativeAlert('-PT30M')],
        ]);

        $holiday = $monday->add(new DateInterval('P11D'))->setTime(0, 0);
        $this->add($out, CalendarCollectionUris::EVENT_HOME, [
            'title' => 'Public holiday',
            'start' => $holiday->format('Y-m-d'),
            'end' => $holiday->add(new DateInterval('P1D'))->format('Y-m-d'),
            'showWithoutTime' => true,
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Dentist',
            'start' => $this->utc($monday->add(new DateInterval('P2D'))->setTime(8, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P2D'))->setTime(8, 45)),
            'alerts' => [
                $this->relativeAlert('-PT1H'),
                $this->relativeAlert('-PT15M'),
            ],
        ]);

        $ams = $monday->add(new DateInterval('P1D'))->setTime(10, 0);
        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Amsterdam catch-up',
            'start' => $ams->format('Y-m-d\TH:i:s'),
            'end' => $ams->add(new DateInterval('PT1H'))->format('Y-m-d\TH:i:s'),
            'timeZone' => 'Europe/Amsterdam',
            'alerts' => [$this->relativeAlert('-PT15M')],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Private note',
            'start' => $this->utc($monday->add(new DateInterval('P3D'))->setTime(20, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P3D'))->setTime(20, 30)),
            'privacy' => 'private',
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Focus block',
            'start' => $this->utc($monday->setTime(13, 0)),
            'end' => $this->utc($monday->setTime(14, 0)),
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'daily',
                'count' => 8,
            ]],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Board meeting',
            'start' => $this->utc($monday->setTime(16, 0)),
            'end' => $this->utc($monday->setTime(17, 30)),
            'recurrenceRules' => [[
                '@type' => 'RecurrenceRule',
                'frequency' => 'monthly',
                'byDay' => [['@type' => 'NDay', 'day' => 'mo', 'nthOfPeriod' => 2]],
            ]],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Vendor walkthrough',
            'start' => $this->utc($monday->add(new DateInterval('P2D'))->setTime(14, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P2D'))->setTime(15, 0)),
            'locations' => [
                'hq' => ['@type' => 'Location', 'name' => 'HQ lobby'],
            ],
            'links' => [
                'meet' => [
                    '@type' => 'Link',
                    'href' => 'https://meet.example.test/vendor',
                    'rel' => 'describedby',
                ],
            ],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Interview loop',
            'start' => $this->utc($monday->add(new DateInterval('P3D'))->setTime(9, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P3D'))->setTime(12, 0)),
            'participants' => [
                'alice' => [
                    '@type' => 'Participant',
                    'name' => 'Alice',
                    'email' => 'alice@localhost',
                    'roles' => ['attendee'],
                    'participationStatus' => 'accepted',
                ],
                'bob' => [
                    '@type' => 'Participant',
                    'name' => 'Bob',
                    'email' => 'bob@localhost',
                    'roles' => ['optional'],
                    'participationStatus' => 'needs-action',
                ],
            ],
        ]);

        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Cancelled kickoff',
            'start' => $this->utc($monday->add(new DateInterval('P8D'))->setTime(9, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P8D'))->setTime(10, 0)),
            'status' => 'cancelled',
        ]);

        $absoluteWhen = $monday->add(new DateInterval('P1D'))->setTime(8, 45);
        $this->add($out, CalendarCollectionUris::EVENT_DEFAULT, [
            'title' => 'Hard-start briefing',
            'start' => $this->utc($monday->add(new DateInterval('P1D'))->setTime(9, 0)),
            'end' => $this->utc($monday->add(new DateInterval('P1D'))->setTime(9, 30)),
            'alerts' => [[
                '@type' => 'Alert',
                'action' => 'display',
                'trigger' => [
                    '@type' => 'AbsoluteAlert',
                    'when' => $this->utc($absoluteWhen),
                ],
            ]],
        ]);

        return $out;
    }

    /**
     * @return list<SeedEvent>
     */
    private function bulkEvents(DateTimeImmutable $monday, int $existingCount): array
    {
        $out = [];
        $need = max(0, self::FULL_TARGET - $existingCount);
        $titles = [
            CalendarCollectionUris::EVENT_WORK => ['1:1', 'Planning', 'Review', 'Workshop', 'Stand-in', 'Demo', 'Office hours'],
            CalendarCollectionUris::EVENT_HOME => ['Errand', 'Family dinner', 'School pickup', 'Chores', 'Walk', 'Movie', 'Repair'],
            CalendarCollectionUris::EVENT_DEFAULT => ['Hold', 'Follow-up', 'Admin time', 'Reading', 'Call', 'Buffer', 'Note'],
        ];
        $calendars = self::EVENT_CALENDAR_URIS;

        for ($i = 0; $i < $need; $i++) {
            $calendarUri = $calendars[$i % count($calendars)];
            $day = $monday->add(new DateInterval('P'.($i % 240).'D'));
            $hour = 8 + ($i % 10);
            $title = $titles[$calendarUri][$i % count($titles[$calendarUri])].' #'.($i + 1);
            $allDay = $i % 11 === 0;
            $event = [
                'title' => $title,
                'description' => 'Dev seed bulk event.',
            ];

            if ($allDay) {
                $event['start'] = $day->format('Y-m-d');
                $event['end'] = $day->add(new DateInterval('P1D'))->format('Y-m-d');
                $event['showWithoutTime'] = true;
            } else {
                $start = $day->setTime($hour, ($i % 2) === 0 ? 0 : 30);
                $event['start'] = $this->utc($start);
                $event['end'] = $this->utc($start->add(new DateInterval($i % 7 === 0 ? 'PT2H' : 'PT1H')));
            }

            if ($i % 5 === 0) {
                $event['alerts'] = [$this->relativeAlert($i % 10 === 0 ? '-PT1H' : '-PT15M')];
            }
            if ($i % 17 === 0) {
                $event['status'] = 'tentative';
            }
            if ($i % 19 === 0) {
                $event['locations'] = [
                    'place' => ['@type' => 'Location', 'name' => 'Cafe '.$i],
                ];
            }
            if ($i % 29 === 0 && ! $allDay) {
                $event['recurrenceRules'] = [$this->weeklyRule(['tu'])];
            }

            $this->add($out, $calendarUri, $event);
        }

        return $out;
    }

    /**
     * @param  list<SeedEvent>  $out
     * @param  array<string, mixed>  $event
     */
    private function add(array &$out, string $calendarUri, array $event): void
    {
        $n = sprintf('%04d', $this->nextIndex++);
        $uid = self::URI_PREFIX.$n;
        $event['@type'] = 'Event';
        $event['uid'] = $uid;
        $event['calendarIds'] = [$calendarUri => true];
        $out[] = [
            'calendarUri' => $calendarUri,
            'objectUri' => $uid.'.ics',
            'event' => $event,
        ];
    }

    /**
     * @param  list<string>  $days
     * @return array<string, mixed>
     */
    private function weeklyRule(array $days): array
    {
        return [
            '@type' => 'RecurrenceRule',
            'frequency' => 'weekly',
            'byDay' => array_map(
                static fn (string $day): array => ['@type' => 'NDay', 'day' => $day],
                $days,
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function relativeAlert(string $offset): array
    {
        return [
            '@type' => 'Alert',
            'action' => 'display',
            'trigger' => [
                '@type' => 'RelativeAlert',
                'offset' => $offset,
                'relatedTo' => 'start',
            ],
        ];
    }

    private function mondayNine(DateTimeImmutable $now): DateTimeImmutable
    {
        $utc = $now->setTimezone(new DateTimeZone('UTC'));
        $daysFromMonday = ((int) $utc->format('N')) - 1;

        return $utc->sub(new DateInterval('P'.$daysFromMonday.'D'))->setTime(9, 0, 0);
    }

    private function utc(DateTimeImmutable $dt): string
    {
        return $dt->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }
}

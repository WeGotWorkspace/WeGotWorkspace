<?php

declare(strict_types=1);

namespace App\Services\Installer;

use App\Services\Calendars\CalendarCollectionUris;
use DateTimeImmutable;
use DateTimeZone;

/**
 * Deterministic VJOURNAL note payloads for local-dev Notes seeding.
 *
 * @phpstan-type SeedNote array{
 *   notebookUri: string,
 *   objectUri: string,
 *   uid: string,
 *   note: array{id: string, title: string, body: string, categories: list<string>, status: ?string},
 *   starred: bool
 * }
 */
final class DevNoteCatalog
{
    public const PROFILE_FULL = 'full';

    public const PROFILE_COMPACT = 'compact';

    public const URI_PREFIX = 'dev-seed-note-';

    public const FULL_TARGET = 1000;

    public const COMPACT_TARGET = 40;

    public const NOTEBOOK_WORK = 'notes-dev-work';

    public const NOTEBOOK_IDEAS = 'notes-dev-ideas';

    /** @var list<string> */
    public const NOTEBOOK_URIS = [
        CalendarCollectionUris::NOTE_GENERAL,
        self::NOTEBOOK_WORK,
        self::NOTEBOOK_IDEAS,
    ];

    /** @var array<string, array{name: string, color: string}> */
    public const EXTRA_NOTEBOOKS = [
        self::NOTEBOOK_WORK => [
            'name' => 'Work',
            'color' => '#3B82F6',
        ],
        self::NOTEBOOK_IDEAS => [
            'name' => 'Ideas',
            'color' => '#10B981',
        ],
    ];

    private int $nextIndex = 1;

    /**
     * @return list<SeedNote>
     */
    public function notes(string $profile, DateTimeImmutable $now): array
    {
        $this->nextIndex = 1;
        $anchor = $now->setTimezone(new DateTimeZone('UTC'));
        $out = $this->representativeNotes($anchor);

        $target = $profile === self::PROFILE_COMPACT ? self::COMPACT_TARGET : self::FULL_TARGET;
        if (count($out) < $target) {
            $out = array_merge($out, $this->bulkNotes($anchor, $target - count($out)));
        }

        return $out;
    }

    /**
     * @return list<SeedNote>
     */
    private function representativeNotes(DateTimeImmutable $now): array
    {
        $out = [];

        $this->add($out, CalendarCollectionUris::NOTE_GENERAL, [
            'title' => 'Welcome to Notes',
            'body' => "Local-dev seed note.\n\nUse this catalog to exercise list virtualization, search, and tags.",
            'categories' => ['dev', 'welcome'],
            'status' => null,
            'starred' => true,
        ]);

        $this->add($out, self::NOTEBOOK_WORK, [
            'title' => 'Sprint planning checklist',
            'body' => $this->mediumBody(
                'Sprint planning',
                [
                    'Confirm capacity with the team',
                    'Pull carry-over items from last sprint',
                    'Slice stories that are larger than one day',
                    'Assign owners before the kickoff call',
                ],
            ),
            'categories' => ['work', 'planning'],
            'status' => null,
            'starred' => true,
        ]);

        $this->add($out, self::NOTEBOOK_IDEAS, [
            'title' => 'Product brainstorm',
            'body' => $this->longBody('Product brainstorm'),
            'categories' => ['ideas', 'product'],
            'status' => null,
            'starred' => false,
        ]);

        $this->add($out, CalendarCollectionUris::NOTE_GENERAL, [
            'title' => 'Archived research dump',
            'body' => "Old notes moved to archive for perf testing.\n\nSTATUS=CANCELLED maps to the Archive sidebar.",
            'categories' => ['archive', 'research'],
            'status' => 'CANCELLED',
            'starred' => false,
        ]);

        $this->add($out, self::NOTEBOOK_WORK, [
            'title' => 'Meeting notes — weekly sync',
            'body' => "## Weekly sync\n\n- Ship Notes seed catalog\n- Keep Calendar seed as the pattern\n- Follow up on Tasks/Docs seeders later\n",
            'categories' => ['meeting', 'work'],
            'status' => null,
            'starred' => false,
        ]);

        return $out;
    }

    /**
     * @return list<SeedNote>
     */
    private function bulkNotes(DateTimeImmutable $now, int $need): array
    {
        $out = [];
        $notebooks = self::NOTEBOOK_URIS;
        $titleRoots = [
            CalendarCollectionUris::NOTE_GENERAL => ['Scratch', 'Reminder', 'Journal', 'Clip', 'Todo dump', 'Link farm', 'Quick capture'],
            self::NOTEBOOK_WORK => ['Spec', 'Retrospective', '1:1 notes', 'Incident log', 'RFC draft', 'Customer call', 'Roadmap'],
            self::NOTEBOOK_IDEAS => ['Spark', 'Sketch', 'Hypothesis', 'Wild idea', 'Prototype', 'Naming', 'Experiment'],
        ];
        $tagPools = [
            ['inbox', 'personal'],
            ['work', 'backlog'],
            ['ideas', 'research'],
            ['meeting', 'follow-up'],
            ['dev', 'perf'],
            ['writing', 'draft'],
        ];

        for ($i = 0; $i < $need; $i++) {
            $notebookUri = $notebooks[$i % count($notebooks)];
            $roots = $titleRoots[$notebookUri];
            $title = $roots[$i % count($roots)].' #'.($i + 1);
            $tags = $tagPools[$i % count($tagPools)];
            if ($i % 9 === 0) {
                $tags[] = 'pinned-topic';
            }

            $bodyVariant = $i % 5;
            $body = match ($bodyVariant) {
                0 => 'Short seed body '.$i.'.',
                1 => $this->mediumBody($title, [
                    'Context for item '.$i,
                    'Next action before end of week',
                    'Owner: admin (dev seed)',
                ]),
                2 => "## {$title}\n\nParagraph one for seed note {$i}.\n\nParagraph two adds a bit more weight for layout and search.\n",
                3 => $this->longBody($title.' ('.$i.')'),
                default => "Bullet dump {$i}:\n\n- Alpha\n- Beta\n- Gamma\n- Delta\n",
            };

            $status = $i % 23 === 0 ? 'CANCELLED' : null;
            $starred = $i % 7 === 0;

            $this->add($out, $notebookUri, [
                'title' => $title,
                'body' => $body,
                'categories' => $tags,
                'status' => $status,
                'starred' => $starred,
            ]);
        }

        return $out;
    }

    /**
     * @param  list<SeedNote>  $out
     * @param  array{title: string, body: string, categories: list<string>, status: ?string, starred: bool}  $fields
     */
    private function add(array &$out, string $notebookUri, array $fields): void
    {
        $n = sprintf('%04d', $this->nextIndex++);
        $uid = self::URI_PREFIX.$n;
        $out[] = [
            'notebookUri' => $notebookUri,
            'objectUri' => $uid.'.ics',
            'uid' => $uid,
            'note' => [
                'id' => $uid,
                'title' => $fields['title'],
                'body' => $fields['body'],
                'categories' => $fields['categories'],
                'status' => $fields['status'],
            ],
            'starred' => $fields['starred'],
        ];
    }

    /**
     * @param  list<string>  $bullets
     */
    private function mediumBody(string $heading, array $bullets): string
    {
        $lines = ["## {$heading}", ''];
        foreach ($bullets as $bullet) {
            $lines[] = '- '.$bullet;
        }
        $lines[] = '';
        $lines[] = 'Seeded for local Notes performance testing.';

        return implode("\n", $lines)."\n";
    }

    private function longBody(string $heading): string
    {
        $paragraphs = [
            "{$heading} — longer markdown body so list rows and the editor surface see realistic payload sizes.",
            'WeGotWorkspace Notes store documents as CalDAV VJOURNAL. SUMMARY is the title; DESCRIPTION is markdown; CATEGORIES are tags.',
            'This seeder mirrors `wgw:calendars:seed-dev`: deterministic URIs, idempotent writes, and `--force` recreate.',
            "Checklist:\n\n1. Open `/notes` at the Vite app\n2. Scroll All / Starred / Archive\n3. Filter by tag\n4. Open a few long notes",
            str_repeat("Lorem padding sentence for volume. ", 24),
        ];

        return "## {$heading}\n\n".implode("\n\n", $paragraphs)."\n";
    }
}

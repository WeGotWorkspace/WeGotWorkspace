<?php

declare(strict_types=1);

namespace App\Services\Installer;

use RuntimeException;

/**
 * Orchestrates modular local-dev seeders (calendars, notes; Tasks/Docs/Meet later).
 *
 * @phpstan-type SeedAppResult array{app: string, created: int, skipped: int, deleted: int, extra?: array<string, int>}
 */
final class DevSeedRunner
{
    /** @var list<string> */
    public const APPS = ['calendars', 'notes'];

    public function __construct(
        private readonly DevCalendarEventSeeder $calendars,
        private readonly DevNoteSeeder $notes,
        private readonly DevSeedGuard $guard,
    ) {}

    public function isAllowed(): bool
    {
        return $this->guard->isAllowed();
    }

    /**
     * @param  list<string>|null  $apps  null / empty = all known apps
     * @return list<SeedAppResult>
     */
    public function seed(
        string $username,
        ?array $apps = null,
        string $profile = 'full',
        bool $force = false,
    ): array {
        $this->guard->assertAllowed('dev data');

        $selected = $this->normalizeApps($apps);
        $results = [];

        foreach ($selected as $app) {
            $results[] = match ($app) {
                'calendars' => $this->seedCalendars($username, $profile, $force),
                'notes' => $this->seedNotes($username, $profile, $force),
                default => throw new RuntimeException('Unknown seed app: '.$app),
            };
        }

        return $results;
    }

    /**
     * @param  list<string>|null  $apps
     * @return list<string>
     */
    private function normalizeApps(?array $apps): array
    {
        if ($apps === null || $apps === []) {
            return self::APPS;
        }

        $out = [];
        foreach ($apps as $app) {
            $normalized = strtolower(trim($app));
            if ($normalized === 'calendar') {
                $normalized = 'calendars';
            }
            if ($normalized === 'note') {
                $normalized = 'notes';
            }
            if (! in_array($normalized, self::APPS, true)) {
                throw new RuntimeException(
                    'Unknown seed app "'.$app.'". Known: '.implode(', ', self::APPS).'.',
                );
            }
            $out[] = $normalized;
        }

        return array_values(array_unique($out));
    }

    /**
     * @return SeedAppResult
     */
    private function seedCalendars(string $username, string $profile, bool $force): array
    {
        $result = $this->calendars->seed($username, $profile, $force);

        return [
            'app' => 'calendars',
            'created' => $result['created'],
            'skipped' => $result['skipped'],
            'deleted' => $result['deleted'],
        ];
    }

    /**
     * @return SeedAppResult
     */
    private function seedNotes(string $username, string $profile, bool $force): array
    {
        $result = $this->notes->seed($username, $profile, $force);

        return [
            'app' => 'notes',
            'created' => $result['created'],
            'skipped' => $result['skipped'],
            'deleted' => $result['deleted'],
            'extra' => [
                'starred' => $result['starred'],
                'notebooks' => $result['notebooks'],
            ],
        ];
    }
}

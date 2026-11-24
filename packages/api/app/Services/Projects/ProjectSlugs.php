<?php

declare(strict_types=1);

namespace App\Services\Projects;

use App\Models\Project;
use Illuminate\Support\Str;

/** Project slugs (#817): unique per Team, archived Projects included. */
final class ProjectSlugs
{
    private const MAX_LENGTH = 80;

    /** `Str::slug` of the name; a clash with a live or archived Project of the Team gets `-2`, `-3`. */
    public function free(string $teamSlug, string $name): string
    {
        $base = trim(Str::substr(Str::slug($name), 0, self::MAX_LENGTH), '-');
        if ($base === '') {
            $base = 'project';
        }
        $taken = array_flip(Project::query()
            ->where('group_slug', $teamSlug)
            ->where('slug', 'like', $base.'%')
            ->pluck('slug')
            ->map(static fn (mixed $slug): string => (string) $slug)
            ->all());

        $candidate = $base;
        for ($suffix = 2; isset($taken[$candidate]); $suffix++) {
            $candidate = $base.'-'.$suffix;
        }

        return $candidate;
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Notes;

use App\Support\AppPaths;

/**
 * Ensures files/groups/{slug}/.notes/ homes for group notebooks.
 */
final class GroupNotesHomesProvisioner
{
    /** Default notebook directory created under each group `.notes` home. */
    public const DEFAULT_NOTEBOOK = 'General';

    public function __construct(private readonly AppPaths $paths) {}

    /**
     * Ensure the group files home, its `.notes` directory, and a default notebook exist.
     *
     * @return bool true when `.notes` was created; false when it already existed (no mutation of `.notes` itself)
     */
    public function ensureForSlug(string $slug): bool
    {
        $slug = trim($slug);
        if ($slug === '' || str_contains($slug, '/') || str_contains($slug, '\\') || str_starts_with($slug, '.')) {
            throw new \InvalidArgumentException('Invalid group slug for notes home.');
        }

        $groupPath = $this->groupFilesPath($slug);
        if (! is_dir($groupPath)) {
            if (! @mkdir($groupPath, 0775, true) && ! is_dir($groupPath)) {
                throw new \RuntimeException('Could not create group files directory for '.$slug.'.');
            }
        }

        $created = $this->ensureNotesDirectory($groupPath);
        if ($created) {
            $this->ensureDefaultNotebook($groupPath.'/.notes');
        }

        return $created;
    }

    /**
     * One-level walk of files/groups/* — mkdir `.notes` only when absent.
     *
     * @return array{scanned: int, created: int, skipped: int}
     */
    public function ensureForAllGroupHomes(): array
    {
        $groupsRoot = rtrim($this->paths->dataDir(), '/').'/files/groups';
        if (! is_dir($groupsRoot)) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $entries = @scandir($groupsRoot);
        if ($entries === false) {
            return ['scanned' => 0, 'created' => 0, 'skipped' => 0];
        }

        $scanned = 0;
        $created = 0;
        $skipped = 0;

        foreach ($entries as $entry) {
            if ($entry === '.' || $entry === '..' || str_starts_with($entry, '.')) {
                continue;
            }

            $groupPath = $groupsRoot.'/'.$entry;
            if (! is_dir($groupPath)) {
                continue;
            }

            $scanned++;
            if ($this->ensureNotesDirectory($groupPath)) {
                $this->ensureDefaultNotebook($groupPath.'/.notes');
                $created++;
            } else {
                $skipped++;
            }
        }

        return ['scanned' => $scanned, 'created' => $created, 'skipped' => $skipped];
    }

    private function groupFilesPath(string $slug): string
    {
        return rtrim($this->paths->dataDir(), '/').'/files/groups/'.$slug;
    }

    /**
     * Cheap directoryExists check — no mtime touch and no readdir when present.
     *
     * @return bool true if created, false if already present
     */
    private function ensureNotesDirectory(string $groupPath): bool
    {
        $notesPath = $groupPath.'/.notes';
        if (is_dir($notesPath)) {
            return false;
        }

        if (! @mkdir($notesPath, 0775) && ! is_dir($notesPath)) {
            throw new \RuntimeException('Could not create group notes directory at '.$notesPath.'.');
        }

        return true;
    }

    /**
     * Ensure a default empty notebook dir so Shared notebooks always has a membership entry.
     */
    private function ensureDefaultNotebook(string $notesPath): void
    {
        if (! is_dir($notesPath)) {
            return;
        }

        $notebookPath = $notesPath.'/'.self::DEFAULT_NOTEBOOK;
        if (is_dir($notebookPath)) {
            return;
        }

        if (! @mkdir($notebookPath, 0775) && ! is_dir($notebookPath)) {
            throw new \RuntimeException('Could not create default group notebook at '.$notebookPath.'.');
        }
    }
}

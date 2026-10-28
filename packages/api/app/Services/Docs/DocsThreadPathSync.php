<?php

declare(strict_types=1);

namespace App\Services\Docs;

use App\Models\CalendarInstance;
use App\Models\CalendarObject;
use App\Models\DocsThreadIndex;
use App\Services\Docs\Conversion\DocsThreadJournalConverter;
use App\Services\Drive\DrivePathBookkeeping;
use App\Storage\StoragePaths;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Sabre\CalDAV\Backend\PDO as CalPDO;

/**
 * Keeps Docs threads on their document when its Drive path changes.
 *
 * Only {@see DrivePathBookkeeping} calls this, so every
 * Drive write surface reaches it the same way. Threads live in the pool of
 * the path's owner: a move into another owner's folder also moves each
 * VJOURNAL into that owner's pool.
 */
final class DocsThreadPathSync
{
    public function __construct(
        private readonly DocsThreadJournalConverter $converter,
        private readonly DocsThreadPoolProvisioner $pools,
        private readonly StoragePaths $paths,
    ) {}

    /**
     * Point threads at $from, and under it, to $to. Threads already at $to
     * belonged to the item the move replaced, so they are dropped first.
     */
    public function retargetPath(string $from, string $to): void
    {
        $from = $this->paths->normalizeVirtualPath($from);
        $to = $this->paths->normalizeVirtualPath($to);
        if ($from === $to) {
            return;
        }

        foreach ($this->rowsUnder($to) as $row) {
            if (! $this->isUnder((string) $row->doc_path, $from)) {
                $this->bestEffort($row, fn () => $this->dropRow($row));
            }
        }
        foreach ($this->rowsUnder($from) as $row) {
            $old = (string) $row->doc_path;
            $newPath = $old === $from ? $to : $to.substr($old, strlen($from));
            $this->bestEffort($row, fn () => $this->moveRow($row, $newPath));
        }
    }

    public function dropPath(string $path): void
    {
        foreach ($this->rowsUnder($this->paths->normalizeVirtualPath($path)) as $row) {
            $this->bestEffort($row, fn () => $this->dropRow($row));
        }
    }

    private function moveRow(DocsThreadIndex $row, string $newPath): void
    {
        $target = $this->pools->ensureForOwner(DocsThreadCollectionUris::ownerPrincipalUri($newPath));

        DB::connection('wgw')->transaction(function () use ($row, $newPath, $target): void {
            $source = $this->poolFor((int) $row->calendarid);
            $object = $this->findObject((int) $row->calendarid, (string) $row->uid);
            if ($source !== null && $object !== null) {
                $ics = $this->converter->applyDocPath($this->rawIcs($object), $newPath);
                if ((int) $target->calendarid === (int) $source->calendarid) {
                    $this->calBackend()->updateCalendarObject($this->ids($source), (string) $object->uri, $ics);
                } else {
                    // Delete first: a thread UID is unique across all VJOURNAL pools.
                    $this->calBackend()->deleteCalendarObject($this->ids($source), (string) $object->uri);
                    $this->calBackend()->createCalendarObject($this->ids($target), (string) $object->uri, $ics);
                }
            }
            $row->doc_path = $newPath;
            $row->calendarid = (int) $target->calendarid;
            $row->save();
        });
    }

    private function dropRow(DocsThreadIndex $row): void
    {
        DB::connection('wgw')->transaction(function () use ($row): void {
            $source = $this->poolFor((int) $row->calendarid);
            $object = $this->findObject((int) $row->calendarid, (string) $row->uid);
            if ($source !== null && $object !== null) {
                $this->calBackend()->deleteCalendarObject($this->ids($source), (string) $object->uri);
            }
            $row->delete();
        });
    }

    /**
     * One broken thread must not keep the others from following the document.
     */
    private function bestEffort(DocsThreadIndex $row, callable $operation): void
    {
        try {
            $operation();
        } catch (\Throwable $e) {
            Log::warning('docs_thread_path_sync_failed', [
                'uid' => (string) $row->uid,
                'path' => (string) $row->doc_path,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * @return Collection<int, DocsThreadIndex>
     */
    private function rowsUnder(string $path): Collection
    {
        // LIKE is a coarse filter (_ and % are wildcards); isUnder() decides.
        return DocsThreadIndex::query()
            ->where(function ($query) use ($path): void {
                $query->where('doc_path', $path)->orWhere('doc_path', 'like', $path.'/%');
            })
            ->get()
            ->filter(fn (DocsThreadIndex $row): bool => $this->isUnder((string) $row->doc_path, $path))
            ->values();
    }

    private function isUnder(string $docPath, string $prefix): bool
    {
        return $docPath === $prefix || str_starts_with($docPath, $prefix.'/');
    }

    private function poolFor(int $calendarId): ?CalendarInstance
    {
        return CalendarInstance::query()
            ->where('calendarid', $calendarId)
            ->where('uri', DocsThreadCollectionUris::POOL_URI)
            ->first();
    }

    private function findObject(int $calendarId, string $uid): ?CalendarObject
    {
        return CalendarObject::query()
            ->where('calendarid', $calendarId)
            ->where('uid', $uid)
            ->first();
    }

    /**
     * @return array{0: int, 1: int}
     */
    private function ids(CalendarInstance $instance): array
    {
        return [(int) $instance->calendarid, (int) $instance->id];
    }

    private function rawIcs(CalendarObject $object): string
    {
        return is_string($object->calendardata) ? $object->calendardata : (string) $object->calendardata;
    }

    private function calBackend(): CalPDO
    {
        return new CalPDO(DB::connection('wgw')->getPdo());
    }
}

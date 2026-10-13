<?php

declare(strict_types=1);

namespace App\Services\Search;

use App\Services\Jmap\FileNodes\FileNodeIndexService;
use Illuminate\Support\Facades\Cache;

final class SearchReindexRunner
{
    private const STALE_PROGRESS_SECONDS = 120;

    public function __construct(
        private SearchReindexStateStore $store,
        private SearchIndexerService $indexer,
        private FileNodeIndexService $fileNodes,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function getState(): array
    {
        $this->recoverStaleLockState();
        $state = $this->store->read();
        $phase = is_string($state['phase'] ?? null) ? $state['phase'] : null;

        return [
            'inProgress' => $phase !== null,
            'phase' => $phase,
            'phaseProgress' => is_array($state['phase_progress'] ?? null) ? $state['phase_progress'] : null,
            'cancelRequested' => (bool) ($state['cancel_requested'] ?? false),
            'lastResult' => is_array($state['last_result'] ?? null) ? $state['last_result'] : null,
            'logLines' => $this->store->readLog(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function run(): array
    {
        $this->store->ensureDirs();
        $lock = Cache::lock('search-reindex-runner', 900);
        if (! $lock->get()) {
            throw new \RuntimeException('Another search reindex process is already running.');
        }

        $result = [
            'ok' => false,
            'message' => '',
            'finishedAt' => null,
        ];
        try {
            $this->store->clearCancelRequest();
            $this->writePhase('starting');
            $this->store->appendLog('Search reindex started.');

            $this->fileNodes->reindexAll();

            $phaseMap = ['files' => 'indexing_files', 'caldav' => 'indexing_caldav', 'carddav' => 'indexing_carddav'];
            $this->indexer->reindexAll(function (int $done, int $total, string $phase) use ($phaseMap): void {
                if ($this->store->isCancelRequested()) {
                    throw new \RuntimeException('Search reindex cancelled by user.');
                }
                $this->writeProgress($phaseMap[$phase] ?? $phase, $done, $total);
            });

            $this->writePhase('finalizing');
            $result['ok'] = true;
            $result['message'] = 'Search reindex completed.';
            $this->store->appendLog('Search reindex completed.');
        } catch (\Throwable $e) {
            $result['message'] = $e->getMessage();
            $this->store->appendLog('Search reindex failed: '.$e->getMessage());
            if ($e->getMessage() !== 'Search reindex cancelled by user.') {
                throw $e;
            }
        } finally {
            $result['finishedAt'] = date('c');
            $state = $this->store->read();
            $state['last_result'] = $result;
            unset($state['phase'], $state['phase_progress'], $state['phase_updated_at'], $state['cancel_requested']);
            $this->store->write($state);
            $lock->release();
            $this->store->clearCancelRequest();
        }

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    public function cancel(): array
    {
        $state = $this->store->read();
        $phase = is_string($state['phase'] ?? null) ? trim((string) $state['phase']) : '';
        if ($phase === '') {
            throw new \InvalidArgumentException('No search reindex is currently running.');
        }
        $this->store->requestCancel();
        $state['cancel_requested'] = true;
        $this->store->write($state);
        $this->store->appendLog('Cancellation requested by admin user.');

        return $this->getState();
    }

    public function recoverStaleLockState(): void
    {
        $state = $this->store->read();
        $phase = is_string($state['phase'] ?? null) ? trim((string) $state['phase']) : '';
        if ($phase === '' || ! $this->isStaleProgressState($state)) {
            return;
        }

        unset($state['phase'], $state['phase_progress'], $state['phase_updated_at'], $state['cancel_requested']);
        $this->store->write($state);
        $this->store->appendLog('Cleared stale search reindex state.');
    }

    private function writePhase(string $phase): void
    {
        $state = $this->store->read();
        $state['phase'] = $phase;
        $state['phase_updated_at'] = date('c');
        $state['cancel_requested'] = $this->store->isCancelRequested();
        unset($state['phase_progress']);
        $this->store->write($state);
    }

    private function writeProgress(string $phase, int $done, int $total): void
    {
        $safeTotal = max(1, $total);
        $safeDone = max(0, min($done, $safeTotal));
        $state = $this->store->read();
        $state['phase'] = $phase;
        $state['phase_progress'] = [
            'completed' => $safeDone,
            'total' => $safeTotal,
            'percent' => min(100, max(0, (int) floor(($safeDone / $safeTotal) * 100))),
            'updatedAt' => date('c'),
        ];
        $state['phase_updated_at'] = date('c');
        $state['cancel_requested'] = $this->store->isCancelRequested();
        $this->store->write($state);
    }

    /**
     * @param  array<string, mixed>  $state
     */
    private function isStaleProgressState(array $state): bool
    {
        $updatedAt = false;
        if (is_array($state['phase_progress'] ?? null) && is_string($state['phase_progress']['updatedAt'] ?? null)) {
            $updatedAt = strtotime((string) $state['phase_progress']['updatedAt']);
        } elseif (is_string($state['phase_updated_at'] ?? null)) {
            $updatedAt = strtotime((string) $state['phase_updated_at']);
        }
        if (! is_int($updatedAt) || $updatedAt <= 0) {
            return true;
        }

        return (time() - $updatedAt) >= self::STALE_PROGRESS_SECONDS;
    }
}

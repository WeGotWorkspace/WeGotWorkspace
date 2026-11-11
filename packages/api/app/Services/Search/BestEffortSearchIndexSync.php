<?php

declare(strict_types=1);

namespace App\Services\Search;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Log;

/**
 * Best-effort search index updates after DAV CRUD — never blocks the primary write.
 */
final class BestEffortSearchIndexSync
{
    /**
     * @param  callable(): void  $callback
     */
    public function sync(string $domain, callable $callback, ?string $davPath = null, ?string $principal = null): void
    {
        try {
            $callback();
        } catch (QueryException $e) {
            $this->logFailure($domain, $davPath, $principal, $e);
        } catch (\Throwable $e) {
            $this->logFailure($domain, $davPath, $principal, $e);
        }
    }

    private function logFailure(string $domain, ?string $davPath, ?string $principal, \Throwable $e): void
    {
        try {
            Log::error('search_index_sync_failed', [
                'domain' => $domain,
                'dav_path' => $davPath,
                'principal' => $principal,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);
        } catch (\Throwable) {
            // Logging is optional outside the Laravel container (e.g. unit tests).
        }
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Search;

/**
 * Search source keys for CalDAV and CardDAV rows: `principal|collectionUri|objectUri`,
 * each part decoded once from the stored DAV segment.
 */
final class DavSourceKeys
{
    public function principal(string $principalUri): ?string
    {
        if (! str_starts_with($principalUri, 'principals/')) {
            return null;
        }

        $username = trim(substr($principalUri, strlen('principals/')));

        return $username !== '' ? $username : null;
    }

    /**
     * Key prefix shared by every row indexed under one collection, ending in `|`.
     */
    public function collectionPrefix(string $principalUri, string $collectionUri): ?string
    {
        $principal = $this->principal($principalUri);
        if ($principal === null || $collectionUri === '') {
            return null;
        }

        return rawurldecode($principal).'|'.rawurldecode($collectionUri).'|';
    }
}

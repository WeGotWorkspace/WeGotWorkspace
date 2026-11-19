<?php

declare(strict_types=1);

namespace App\Services\Threads;

use App\Models\Principal;

/**
 * Display names for thread authors, in one query (#2173 chunk A). A username
 * with no principal is left out, so callers fall back to the username itself.
 */
final class ThreadAuthorNames
{
    /**
     * @param  list<string>  $usernames
     * @return array<string, string> username => display name
     */
    public static function lookup(array $usernames): array
    {
        $usernames = array_values(array_filter($usernames, static fn (string $name): bool => $name !== ''));
        if ($usernames === []) {
            return [];
        }

        $names = [];
        $principals = Principal::query()
            ->whereIn('uri', array_map(static fn (string $name): string => 'principals/'.$name, $usernames))
            ->get(['uri', 'displayname']);
        foreach ($principals as $principal) {
            $username = substr((string) $principal->uri, strlen('principals/'));
            $display = trim((string) ($principal->displayname ?? ''));
            $names[$username] = $display !== '' ? $display : $username;
        }

        return $names;
    }
}

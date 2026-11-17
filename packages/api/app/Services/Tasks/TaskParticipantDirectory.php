<?php

declare(strict_types=1);

namespace App\Services\Tasks;

use App\Models\Principal;
use App\Services\Tasks\Conversion\TaskConversionSupport;

/**
 * Maps task participant addresses to the people on this instance (#2172).
 *
 * The converter reads an ATTENDEE without `X-WGW-USERNAME` as `e:<address>`.
 * When that address is a user's email, the participant is that user, so it
 * reads as `u:<username>`, just as an assignee the app wrote. Lookups are
 * batched per call and never cached across calls.
 */
final class TaskParticipantDirectory
{
    /**
     * Re-keys `e:` participants whose address belongs to a user. Order is kept;
     * when a user is already listed, the later entry is dropped (first line wins).
     *
     * @param  array<string, mixed>  $task
     * @return array<string, mixed>
     */
    public function resolveTask(array $task): array
    {
        $participants = $task['participants'] ?? null;
        if (! is_array($participants) || $participants === []) {
            return $task;
        }

        $usernames = $this->usernamesForEmails(array_values(array_filter(array_map(
            static fn (mixed $id): ?string => self::emailFromId((string) $id),
            array_keys($participants),
        ))));
        if ($usernames === []) {
            return $task;
        }

        $resolved = [];
        foreach ($participants as $id => $entry) {
            $email = self::emailFromId((string) $id);
            $username = $email !== null ? ($usernames[$email] ?? null) : null;
            if ($username === null || ! is_array($entry)) {
                $resolved[(string) $id] ??= $entry;

                continue;
            }
            $userId = TaskConversionSupport::USER_ID_PREFIX.$username;
            if (! isset($resolved[$userId])) {
                $entry['username'] = $username;
                $resolved[$userId] = $entry;
            }
        }
        $task['participants'] = $resolved;

        return $task;
    }

    /** The user whose email is `$email`, or null for an address no account has. */
    public function usernameForEmail(string $email): ?string
    {
        $email = strtolower(trim($email));

        return $email === '' ? null : ($this->usernamesForEmails([$email])[$email] ?? null);
    }

    /**
     * @param  list<string>  $emails  lowercased addresses
     * @return array<string, string> address => username
     */
    private function usernamesForEmails(array $emails): array
    {
        $emails = array_values(array_unique(array_filter($emails, static fn (string $email): bool => $email !== '')));
        if ($emails === []) {
            return [];
        }

        $placeholders = implode(',', array_fill(0, count($emails), '?'));
        $rows = Principal::query()
            ->whereRaw('lower(email) in ('.$placeholders.')', $emails)
            ->where('uri', 'like', 'principals/%')
            ->where('uri', 'not like', 'principals/%/%')
            ->orderBy('id')
            ->get(['uri', 'email']);

        $usernames = [];
        foreach ($rows as $row) {
            $email = strtolower(trim((string) $row->email));
            $usernames[$email] ??= strtolower(substr((string) $row->uri, strlen('principals/')));
        }

        return $usernames;
    }

    private static function emailFromId(string $id): ?string
    {
        if (! str_starts_with($id, TaskConversionSupport::EMAIL_ID_PREFIX)) {
            return null;
        }
        $email = strtolower(trim(substr($id, strlen(TaskConversionSupport::EMAIL_ID_PREFIX))));

        return $email !== '' ? $email : null;
    }
}

<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\CalendarInstance;
use App\Models\Principal;
use App\Services\Calendars\CalendarShareInvites;

/**
 * Shared access-granted notify for calendar / notes / tasks collection shareWith.
 */
final class CollectionSharedNotify
{
    public const CALENDAR_ACTION = 'shared';

    public const NOTES_ACTION = 'shared';

    public const TASKS_ACTION = 'list_shared';

    /**
     * Diff sharees before/after {@see CalendarShareInvites::apply} and return newly granted usernames.
     *
     * @return list<string>
     */
    public static function applyAndAddedUsernames(
        CalendarShareInvites $shareInvites,
        CalendarInstance $instance,
        ?string $groupSlug,
        mixed $shareWith,
    ): array {
        $before = self::shareeUsernames($shareInvites, $instance, $groupSlug);
        $shareInvites->apply($instance, $groupSlug, $shareWith);
        $instance->refresh();
        $after = self::shareeUsernames($shareInvites, $instance, $groupSlug);

        return array_values(array_diff($after, $before));
    }

    /**
     * @param  list<string>  $recipients
     * @return array{
     *     recipients: list<string>,
     *     actor: string,
     *     collectionName: string,
     *     collectionId: string,
     *     access: string,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string
     * }
     */
    public static function eventData(
        string $domain,
        string $actorLabel,
        string $collectionName,
        string $collectionId,
        string $access,
        array $recipients,
    ): array {
        $navigate = match ($domain) {
            'notes' => '/notes',
            'tasks' => '/tasks',
            default => '/calendar',
        };
        $action = $domain === 'tasks' ? self::TASKS_ACTION : self::CALENDAR_ACTION;
        $dedupe = $domain.'.'.$action.':'.$collectionId;

        $facts = [
            'recipients' => $recipients,
            'actor' => $actorLabel,
            'access' => $access,
            'navigate' => $navigate,
            'tag' => $dedupe,
            'dedupe_key' => $dedupe,
        ];

        return match ($domain) {
            'notes' => [
                ...$facts,
                'notebookName' => $collectionName,
                'notebookId' => $collectionId,
                'collectionName' => $collectionName,
                'collectionId' => $collectionId,
            ],
            'tasks' => [
                ...$facts,
                'listName' => $collectionName,
                'taskListId' => $collectionId,
                'collectionName' => $collectionName,
                'collectionId' => $collectionId,
            ],
            default => [
                ...$facts,
                'calendarName' => $collectionName,
                'calendarId' => $collectionId,
                'collectionName' => $collectionName,
                'collectionId' => $collectionId,
            ],
        };
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(string $domain, array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        if ($actor === '') {
            $actor = 'Someone';
        }
        $name = trim((string) (
            $data['calendarName']
            ?? $data['notebookName']
            ?? $data['listName']
            ?? $data['collectionName']
            ?? ''
        ));
        if ($name === '') {
            $name = match ($domain) {
                'notes' => 'a notebook',
                'tasks' => 'a task list',
                default => 'a calendar',
            };
        }
        $access = trim((string) ($data['access'] ?? 'read'));
        $noun = match ($domain) {
            'notes' => 'notebook',
            'tasks' => 'task list',
            default => 'calendar',
        };

        return [
            'title' => $actor.' shared '.$name.' with you',
            'body' => $noun.' access: '.$access,
        ];
    }

    public static function actorLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }

    /**
     * @return list<string>
     */
    private static function shareeUsernames(
        CalendarShareInvites $shareInvites,
        CalendarInstance $instance,
        ?string $groupSlug,
    ): array {
        $grants = $shareInvites->shareWithForOwner($instance, $groupSlug) ?? [];
        $out = [];
        foreach (array_keys($grants) as $id) {
            if (! is_string($id)) {
                continue;
            }
            $trimmed = strtolower(trim($id));
            if ($trimmed !== '' && ! str_starts_with($trimmed, 'groups/')) {
                $out[$trimmed] = $trimmed;
            }
        }

        return array_values($out);
    }
}

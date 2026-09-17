<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\Principal;

/**
 * Structured facts + copy for tasks.status_changed.
 */
final class TaskStatusChangedNotify
{
    public const ACTION = 'status_changed';

    public const NAVIGATE = '/tasks';

    /**
     * @param  list<string>  $recipients
     * @return array{
     *     recipients: list<string>,
     *     actor: string,
     *     summary: string,
     *     taskId: string,
     *     fromStatus: string|null,
     *     toStatus: string,
     *     taskListId: string,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string,
     *     supersede: true
     * }
     */
    public static function eventData(
        string $actorLabel,
        string $summary,
        string $taskId,
        ?string $fromStatus,
        string $toStatus,
        string $taskListId,
        array $recipients,
    ): array {
        return [
            'recipients' => $recipients,
            'actor' => $actorLabel,
            'summary' => trim($summary),
            'taskId' => $taskId,
            'fromStatus' => $fromStatus,
            'toStatus' => $toStatus,
            'taskListId' => $taskListId,
            'navigate' => self::NAVIGATE,
            'tag' => self::dedupeKey($taskId),
            'dedupe_key' => self::dedupeKey($taskId),
            'supersede' => true,
        ];
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{title: string, body: string|null}
     */
    public static function formatCopy(array $data): array
    {
        $actor = trim((string) ($data['actor'] ?? ''));
        if ($actor === '') {
            $actor = 'Someone';
        }
        $summary = trim((string) ($data['summary'] ?? ''));
        if ($summary === '') {
            $summary = 'a task';
        }
        $to = trim((string) ($data['toStatus'] ?? ''));
        $from = isset($data['fromStatus']) && is_string($data['fromStatus']) ? trim($data['fromStatus']) : '';

        $title = $to === 'completed'
            ? $actor.' completed '.$summary
            : $actor.' updated '.$summary;
        $body = $from !== '' && $to !== ''
            ? $from.' → '.$to
            : ($to !== '' ? $to : null);

        return [
            'title' => $title,
            'body' => $body,
        ];
    }

    public static function dedupeKey(string $taskId): string
    {
        return 'tasks.status_changed:'.trim($taskId);
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
}

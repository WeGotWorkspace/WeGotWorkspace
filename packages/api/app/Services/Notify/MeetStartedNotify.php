<?php

declare(strict_types=1);

namespace App\Services\Notify;

use App\Models\ChatChannelMeta;
use App\Models\Principal;
use App\Services\Chat\ChatMessagePostedNotify;

/**
 * Structured facts + copy for meet.started (first room activation).
 */
final class MeetStartedNotify
{
    public const ACTION = 'started';

    /**
     * @param  list<string>  $recipients
     * @return array{
     *     recipients: list<string>,
     *     actor: string,
     *     room: string,
     *     channelUri: string|null,
     *     kind: string|null,
     *     navigate: string,
     *     tag: string,
     *     dedupe_key: string
     * }
     */
    public static function eventData(
        string $actorLabel,
        string $room,
        array $recipients,
        ?string $channelUri = null,
        ?string $kind = null,
    ): array {
        $navigate = '/meet';
        if ($channelUri !== null && $channelUri !== '') {
            $navigate = ChatMessagePostedNotify::navigate(
                $channelUri,
                $kind ?? ChatChannelMeta::KIND_CHANNEL,
                '',
            );
        } elseif ($room !== '') {
            $navigate = '/meet/meetings/'.rawurlencode($room);
        }

        return [
            'recipients' => $recipients,
            'actor' => $actorLabel,
            'room' => $room,
            'channelUri' => $channelUri,
            'kind' => $kind,
            'navigate' => $navigate,
            'tag' => self::dedupeKey($room),
            'dedupe_key' => self::dedupeKey($room),
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
        $room = trim((string) ($data['room'] ?? ''));

        return [
            'title' => $actor.' started a meeting',
            'body' => $room !== '' ? $room : null,
        ];
    }

    public static function dedupeKey(string $room): string
    {
        return 'meet.started:'.trim($room);
    }

    public static function actorLabel(string $username): string
    {
        $trimmed = trim($username);
        if ($trimmed === '') {
            return 'Someone';
        }
        if (str_starts_with($trimmed, 'u:')) {
            $trimmed = substr($trimmed, 2);
        }
        $principal = Principal::forUsername($trimmed);
        $name = trim((string) ($principal?->displayname ?? ''));

        return $name !== '' ? $name : $trimmed;
    }
}
